import IORedis from 'ioredis'

/**
 * Fixed-window rate limiter. Redis-backed (shared by every PM2 process and survives restarts),
 * with a bounded in-memory fallback when Redis is unavailable so limits still apply.
 */

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

let redis: IORedis | null = null
function getRedis(): IORedis | null {
  if (redis) return redis
  try {
    redis = new IORedis(REDIS_URL, {
      tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      lazyConnect: false,
    })
    redis.on('error', () => { /* handled by fallback */ })
  } catch {
    redis = null
  }
  return redis
}

const memory = new Map<string, { count: number; resetAt: number }>()
const MEMORY_MAX_KEYS = 10_000

function memoryHit(key: string, windowMs: number): number {
  const now = Date.now()
  if (memory.size > MEMORY_MAX_KEYS) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k)
    // still too big → drop oldest entries so the map can't grow without bound
    if (memory.size > MEMORY_MAX_KEYS) {
      for (const k of Array.from(memory.keys()).slice(0, memory.size - MEMORY_MAX_KEYS / 2)) memory.delete(k)
    }
  }
  const rec = memory.get(key)
  if (!rec || rec.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs })
    return 1
  }
  rec.count += 1
  return rec.count
}

export type RateLimitResult = { limited: boolean; count: number; retryAfterSeconds: number }

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const fullKey = `rl:${key}`
  const client = getRedis()
  if (client && client.status === 'ready') {
    try {
      // One pipelined round trip (INCR + EXPIRE NX) instead of INCR then a second EXPIRE on first hit.
      const res = await client.multi().incr(fullKey).expire(fullKey, windowSeconds, 'NX').exec()
      const count = Number(res?.[0]?.[1])
      if (!Number.isFinite(count)) throw new Error('bad rate-limit reply')
      return { limited: count > limit, count, retryAfterSeconds: windowSeconds }
    } catch {
      // fall through to memory
    }
  }
  const count = memoryHit(fullKey, windowSeconds * 1000)
  return { limited: count > limit, count, retryAfterSeconds: windowSeconds }
}

/** Sensitive public endpoints get their own, much tighter budget than the global limit. */
export const SENSITIVE_PATH_LIMITS: Array<{ match: (p: string) => boolean; name: string; limit: number; windowSeconds: number }> = [
  { name: 'sign-in', match: (p) => p === '/api/sign-in', limit: 10, windowSeconds: 60 },
  { name: 'sign-up', match: (p) => p === '/api/sign-up', limit: 5, windowSeconds: 300 },
  { name: 'forgot-password', match: (p) => p.startsWith('/api/auth/'), limit: 5, windowSeconds: 300 },
  { name: 'admin-create', match: (p) => p === '/api/admin/user', limit: 5, windowSeconds: 600 },
  { name: 'admin-activate', match: (p) => p === '/api/admin/activate', limit: 8, windowSeconds: 300 },
]
