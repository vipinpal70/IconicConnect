import IORedis from 'ioredis'
import { redis } from '@/src/lib/redis'
import type { SupportSide } from './constants'

/**
 * Live updates for support (support-system.md §11): Redis pub/sub fans events out to every web process,
 * and each process forwards them to its open SSE streams.
 *
 * Events are SIGNALS, not data: they carry ids only ("conversation X has a new message"), never message
 * text. The browser then fetches through the normal, access-checked API. So a stream can never leak
 * content, and a lost event only delays an update (Postgres stays the source of truth; every
 * (re)connect starts with a full resync).
 *
 * Channels:
 *   sup:lab:<clientId>  – what that lab's people may know about (public messages, status, read, typing)
 *   sup:agents          – everything agents may know about (including internal notes)
 */

export type SupportEvent =
  | { type: 'message'; ticketId: string; seq: number }
  | { type: 'ticket'; ticketId: string }
  | { type: 'read'; ticketId: string; side: SupportSide; seq: number }
  | { type: 'typing'; ticketId: string; userId: string; name: string; side: SupportSide }

const CHANNEL_PREFIX = 'sup:'
export const agentsChannel = `${CHANNEL_PREFIX}agents`
export const labChannel = (clientId: string) => `${CHANNEL_PREFIX}lab:${clientId}`

/** Fire-and-forget: a Redis hiccup must never fail the action that produced the event. */
export async function publish(channels: string[], event: SupportEvent): Promise<void> {
  const payload = JSON.stringify(event)
  await Promise.all(channels.map((c) => redis.publish(c, payload).catch(() => 0)))
}

/** A change everyone involved should see (public message, status, assignment, read receipt). */
export const publishToBoth = (clientId: string, event: SupportEvent) => publish([labChannel(clientId), agentsChannel], event)
/** Agent-only knowledge (internal notes, a note being typed). */
export const publishToAgents = (event: SupportEvent) => publish([agentsChannel], event)

// ── One subscriber connection per process, shared by all streams ──────────────────────────────────

type Listener = (event: SupportEvent) => void

interface Hub {
  connection: IORedis
  listeners: Map<string, Set<Listener>>
}

const g = globalThis as unknown as { __supportHub?: Hub }

function hub(): Hub {
  if (g.__supportHub) return g.__supportHub
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  // A subscriber blocks its connection, so it can't be the shared request client. No command timeout:
  // it waits for messages indefinitely and reconnects (re-subscribing) on its own.
  const connection = new IORedis(url, {
    tls: url.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  })
  const listeners = new Map<string, Set<Listener>>()
  connection.on('message', (channel: string, message: string) => {
    const set = listeners.get(channel)
    if (!set || set.size === 0) return
    let event: SupportEvent
    try {
      event = JSON.parse(message) as SupportEvent
    } catch {
      return
    }
    set.forEach((listener) => listener(event))
  })
  connection.on('error', (err) => console.error('[support realtime]', err.message))
  g.__supportHub = { connection, listeners }
  return g.__supportHub
}

/** Listen on channels; returns an unsubscribe function. */
export function subscribe(channels: string[], listener: Listener): () => void {
  const { connection, listeners } = hub()
  for (const channel of channels) {
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
      connection.subscribe(channel).catch((err) => console.error('[support realtime] subscribe', err.message))
    }
    set.add(listener)
  }
  return () => {
    for (const channel of channels) {
      const set = listeners.get(channel)
      if (!set) continue
      set.delete(listener)
      if (set.size === 0) {
        listeners.delete(channel)
        connection.unsubscribe(channel).catch(() => {})
      }
    }
  }
}

// ── Presence and stream limits ────────────────────────────────────────────────────────────────────

const STREAMS_KEY = (userId: string) => `sup:streams:${userId}`
const AGENTS_ONLINE_KEY = 'sup:agents:online'
/** A stream refreshes its heartbeat every 25 s; anything older is a dead connection. */
const STALE_MS = 90_000
export const MAX_STREAMS_PER_USER = 5

/** Registers a stream; false when the user already has too many open (e.g. dozens of tabs). */
export async function openStream(userId: string, connectionId: string, isAgent: boolean): Promise<boolean> {
  const now = Date.now()
  try {
    const key = STREAMS_KEY(userId)
    await redis.zremrangebyscore(key, 0, now - STALE_MS)
    if ((await redis.zcard(key)) >= MAX_STREAMS_PER_USER) return false
    await redis.multi().zadd(key, now, connectionId).pexpire(key, STALE_MS).exec()
    if (isAgent) await redis.zadd(AGENTS_ONLINE_KEY, now, userId)
  } catch {
    // Redis down: don't block support; the limit simply isn't enforced meanwhile
  }
  return true
}

export async function heartbeatStream(userId: string, connectionId: string, isAgent: boolean) {
  const now = Date.now()
  await redis.multi().zadd(STREAMS_KEY(userId), now, connectionId).pexpire(STREAMS_KEY(userId), STALE_MS).exec().catch(() => null)
  if (isAgent) await redis.zadd(AGENTS_ONLINE_KEY, now, userId).catch(() => 0)
}

export async function closeStream(userId: string, connectionId: string) {
  await redis.zrem(STREAMS_KEY(userId), connectionId).catch(() => 0)
}

/** Is any support agent connected right now? (Shown to labs as "We're online".) */
export async function agentsOnline(): Promise<boolean> {
  try {
    return (await redis.zcount(AGENTS_ONLINE_KEY, Date.now() - STALE_MS, '+inf')) > 0
  } catch {
    return false
  }
}

/** Which of these people have the app open right now (a live support stream). Used to skip digest emails. */
export async function usersWithOpenStreams(userIds: string[]): Promise<Set<string>> {
  const online = new Set<string>()
  if (userIds.length === 0) return online
  try {
    const since = Date.now() - STALE_MS
    const pipeline = redis.pipeline()
    for (const id of userIds) pipeline.zcount(STREAMS_KEY(id), since, '+inf')
    const results = (await pipeline.exec()) ?? []
    results.forEach(([error, n], i) => {
      if (!error && Number(n) > 0) online.add(userIds[i])
    })
  } catch {
    // Unknown presence: treat everyone as away. An extra email beats a missed reply.
  }
  return online
}
