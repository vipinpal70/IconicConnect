import IORedis from 'ioredis'

/**
 * One Redis subscriber connection per process, shared by all streams.
 */

export interface LiveEvent {
  type: string
  [field: string]: unknown
}
export type LiveListener = (event: LiveEvent, version: number | null) => void

interface Hub {
  connection: IORedis
  listeners: Map<string, Set<LiveListener>>
  /** Resolves when Redis has confirmed the subscription: nothing published later can be missed. */
  subscribed: Map<string, Promise<unknown>>
  onReconnect: Set<() => void>
}

const g = globalThis as unknown as { __liveHub?: Hub }

function decode(message: string): { event: LiveEvent; version: number | null } | null {
  try {
    const parsed = JSON.parse(message)
    // A bare event comes from a process still running the previous release
    if (parsed && typeof parsed.type === 'string') return { event: parsed, version: null }
    if (parsed?.e && typeof parsed.e.type === 'string') return { event: parsed.e, version: typeof parsed.v === 'number' ? parsed.v : null }
  } catch {
    // not ours
  }
  return null
}

function hub(): Hub {
  if (g.__liveHub) return g.__liveHub
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  // A subscriber blocks its connection, so it can't be the shared request client. No command timeout:
  // it waits for messages indefinitely and reconnects (re-subscribing) on its own.
  const connection = new IORedis(url, {
    tls: url.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  })
  const created: Hub = { connection, listeners: new Map(), subscribed: new Map(), onReconnect: new Set() }
  connection.on('message', (channel: string, message: string) => {
    const set = created.listeners.get(channel)
    if (!set || set.size === 0) return
    const decoded = decode(message)
    if (decoded) set.forEach((listener) => listener(decoded.event, decoded.version))
  })
  let first = true
  connection.on('ready', () => {
    // Events published while we were away are gone: tell the streams to compare versions. A moment later,
    // so the automatic re-subscription is in place first.
    if (!first) setTimeout(() => created.onReconnect.forEach((fn) => fn()), 1000)
    first = false
  })
  connection.on('error', (err) => console.error('[live] subscriber', err.message))
  g.__liveHub = created
  return created
}

/** Listen on channels. `ready` resolves once Redis confirmed every subscription. */
export function listen(channels: string[], listener: LiveListener): { ready: Promise<void>; stop: () => void } {
  const { connection, listeners, subscribed } = hub()
  const waits: Promise<unknown>[] = []
  for (const channel of channels) {
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
      subscribed.set(channel, connection.subscribe(channel).catch((err) => console.error('[live] subscribe', err.message)))
    }
    set.add(listener)
    waits.push(subscribed.get(channel)!)
  }
  let stopped = false
  return {
    ready: Promise.all(waits).then(() => {}),
    stop: () => {
      if (stopped) return
      stopped = true
      for (const channel of channels) {
        const set = listeners.get(channel)
        if (!set) continue
        set.delete(listener)
        if (set.size === 0) {
          listeners.delete(channel)
          subscribed.delete(channel)
          connection.unsubscribe(channel).catch(() => {})
        }
      }
    },
  }
}

/** Runs after the subscriber lost and regained Redis. */
export function onBusReconnect(fn: () => void): () => void {
  const { onReconnect } = hub()
  onReconnect.add(fn)
  return () => onReconnect.delete(fn)
}
