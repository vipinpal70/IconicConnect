import IORedis from 'ioredis'

/**
 * Redis for the REQUEST PATH (sessions, rate limits, caches, lockout counters, reset tokens).
 *
 * This is deliberately NOT the BullMQ connection. BullMQ needs `maxRetriesPerRequest: null` ("wait forever, jobs
 * must not be lost"), which is exactly wrong for a web request: with Redis unreachable every request would hang
 * until a proxy/Cloudflare timeout kills it (seen in testing: sign-in page and /api/health never answered).
 *
 * Here every command is bounded:
 *   - commandTimeout 1.5 s   → a stuck/slow Redis rejects instead of hanging the request
 *   - maxRetriesPerRequest 1 → fail fast while reconnecting
 *   - a small circuit breaker (`guarded`) → after a connection failure, callers fail IMMEDIATELY for a few seconds
 *     instead of each paying the timeout again, then probe again automatically.
 * Callers decide what "Redis is down" means: rate limiting falls back to memory, caches fall back to the database,
 * the session store answers 503 (see src/proxy.ts).
 */
const URL = process.env.REDIS_URL || 'redis://localhost:6379'

const g = globalThis as unknown as { __iconicRedis?: IORedis; __iconicRedisLogAt?: number }

export const redis: IORedis =
  g.__iconicRedis ??
  (g.__iconicRedis = new IORedis(URL, {
    tls: URL.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: 1,
    commandTimeout: 1500,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 250, 3000), // keep reconnecting forever, backing off to 3 s
    enableOfflineQueue: true,                               // commands issued during the first connect are held (bounded by commandTimeout)
  }))

redis.on('error', (err) => {
  // Throttled: a dead Redis would otherwise print this on every reconnect attempt.
  const now = Date.now()
  if (!g.__iconicRedisLogAt || now - g.__iconicRedisLogAt > 15_000) {
    g.__iconicRedisLogAt = now
    console.error('[Redis (request path)]', err.message || err)
  }
})

export class RedisUnavailableError extends Error {
  constructor() { super('Redis unavailable (circuit open)') }
}

let openUntil = 0
const READY_WAIT_MS = 2500
let readyWait: Promise<boolean> | null = null

/** One shared wait (not one per request) for the connection to become ready — covers cold start and reconnects. */
function waitUntilReady(): Promise<boolean> {
  if (redis.status === 'ready') return Promise.resolve(true)
  readyWait ??= new Promise<boolean>((resolve) => {
    const done = (v: boolean) => { clearTimeout(timer); redis.off('ready', onReady); readyWait = null; resolve(v) }
    const onReady = () => done(true)
    const timer = setTimeout(() => done(false), READY_WAIT_MS)
    redis.once('ready', onReady)
  })
  return readyWait
}

const isConnectionProblem = (e: unknown) =>
  /Command timed out|Connection is closed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|Stream isn't writeable|max retries per request|READONLY|LOADING|MISCONF/i.test(String((e as Error)?.message))

/** Run a Redis operation with the circuit breaker. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  if (Date.now() < openUntil) throw new RedisUnavailableError()
  if (redis.status !== 'ready' && !(await waitUntilReady())) {
    openUntil = Date.now() + 4000
    throw new RedisUnavailableError()
  }
  try {
    return await fn()
  } catch (e) {
    if (isConnectionProblem(e)) openUntil = Date.now() + 4000
    throw e
  }
}

/** True for errors that mean "the Redis session/cache store is unreachable" (callers answer 503, not 500). */
export const isRedisProblem = (e: unknown) => e instanceof RedisUnavailableError || isConnectionProblem(e)

export const redisIsUp = () => redis.status === 'ready' && Date.now() >= openUntil
