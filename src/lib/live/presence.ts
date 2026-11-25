import { redis } from '@/src/lib/redis'

/**
 * Two different facts about a person:
 *   - open streams: how many connections they hold (limited per person);
 *   - present: a tab was visible in the last few minutes. This is what "We're online" and "they'll see it
 *     live, so don't email" mean. A forgotten tab keeps its stream but stops being present.
 */

const STREAMS_KEY = (userId: string) => `sup:streams:${userId}`
const AGENTS_ONLINE_KEY = 'sup:agents:online'
const PRESENT_KEY = (userId: string) => `live:present:${userId}`
/** A stream refreshes its heartbeat every 25 s; anything older is a dead connection. */
export const STALE_MS = 90_000
/** One per browser. Room to spare: after a crash, dead connections count until they go stale. */
export const MAX_STREAMS_PER_USER = 10
/** Visible tabs report every 4 minutes. */
export const PRESENT_SECONDS = 6 * 60

/** Registers a stream; false when the person already has too many open. Opening one means a page was just shown. */
export async function openStream(userId: string, connectionId: string, isAgent: boolean): Promise<boolean> {
  const now = Date.now()
  try {
    const key = STREAMS_KEY(userId)
    await redis.zremrangebyscore(key, 0, now - STALE_MS)
    if ((await redis.zcard(key)) >= MAX_STREAMS_PER_USER) return false
    await redis.multi().zadd(key, now, connectionId).pexpire(key, STALE_MS).exec()
    await markPresent(userId, isAgent)
  } catch {
    // Redis down: don't block anyone; the limit simply isn't enforced meanwhile
  }
  return true
}

/** A tab of this person is visible now. */
export async function markPresent(userId: string, isAgent: boolean) {
  try {
    const m = redis.multi().set(PRESENT_KEY(userId), '1', 'EX', PRESENT_SECONDS)
    if (isAgent) m.zadd(AGENTS_ONLINE_KEY, Date.now(), userId)
    await m.exec()
  } catch {
    // Unknown presence counts as away
  }
}

/** All heartbeats of this process in two round trips. */
export async function heartbeatStreams(streams: Array<{ userId: string; connectionId: string; isAgent: boolean }>) {
  if (streams.length === 0) return
  const now = Date.now()
  try {
    const beats = redis.pipeline()
    for (const s of streams) beats.zadd(STREAMS_KEY(s.userId), now, s.connectionId).pexpire(STREAMS_KEY(s.userId), STALE_MS)
    await beats.exec()
    const agents = [...new Set(streams.filter((s) => s.isAgent).map((s) => s.userId))]
    const present = agents.length ? await redis.mget(agents.map(PRESENT_KEY)) : []
    const online = agents.filter((_, i) => present[i] !== null)
    if (online.length) await redis.zadd(AGENTS_ONLINE_KEY, ...online.flatMap((id) => [now, id]))
  } catch {
    // Missed beats only make a stream look closed a little early
  }
}

export const heartbeatStream = (userId: string, connectionId: string, isAgent: boolean) =>
  heartbeatStreams([{ userId, connectionId, isAgent }])

/** The last stream closing means they left (a page reload opens the next one right away). */
export async function closeStream(userId: string, connectionId: string) {
  try {
    const key = STREAMS_KEY(userId)
    await redis.zrem(key, connectionId)
    if ((await redis.zcount(key, Date.now() - STALE_MS, '+inf')) === 0) {
      await redis.multi().del(PRESENT_KEY(userId)).zrem(AGENTS_ONLINE_KEY, userId).exec()
    }
  } catch {
    // expires by itself
  }
}

/** Is any support agent around right now? (Shown to labs as "We're online".) */
export async function agentsOnline(): Promise<boolean> {
  try {
    return (await redis.zcount(AGENTS_ONLINE_KEY, Date.now() - STALE_MS, '+inf')) > 0
  } catch {
    return false
  }
}

/** Which of these people have the app open in front of them. Used to skip digest emails. */
export async function presentUsers(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  try {
    const present = await redis.mget(userIds.map(PRESENT_KEY))
    return new Set(userIds.filter((_, i) => present[i] !== null))
  } catch {
    // Unknown presence: treat everyone as away. An extra email beats a missed reply.
    return new Set()
  }
}
