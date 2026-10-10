import { connection as redis } from '@/src/lib/queue/client'

/**
 * Sliding-window-counter rate limiter (two adjacent fixed buckets weighted by overlap): O(1) memory per key,
 * one Redis round trip (Lua), no burst-at-boundary hole of a plain fixed window.
 * Repeat offenders get an escalating ban (`rl:ban:*`) so a flood is rejected with a single cheap GET.
 * Falls back to a bounded in-memory limiter when Redis is down, so limits still apply (fail-closed-ish).
 */

const SLIDING = `
local cur = redis.call('INCR', KEYS[1])
if cur == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2] * 2) end
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
local frac = tonumber(ARGV[1])
local est = prev * (1 - frac) + cur
return {math.floor(est), cur}
`

const memory = new Map<string, { count: number; resetAt: number }>()
function memoryHit(key: string, windowMs: number): number {
  const now = Date.now()
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k)
    if (memory.size > 10_000) memory.clear()
  }
  const rec = memory.get(key)
  if (!rec || rec.resetAt <= now) { memory.set(key, { count: 1, resetAt: now + windowMs }); return 1 }
  return ++rec.count
}

export type RateLimitResult = { limited: boolean; count: number; retryAfterSeconds: number }

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const nowSec = Date.now() / 1000
  const bucket = Math.floor(nowSec / windowSeconds)
  const frac = (nowSec % windowSeconds) / windowSeconds
  try {
    const banTtl = await redis.ttl(`rl:ban:${key}`)
    if (banTtl > 0) return { limited: true, count: limit + 1, retryAfterSeconds: banTtl }
    const [est] = (await redis.eval(
      SLIDING, 2, `rl:${key}:${bucket}`, `rl:${key}:${bucket - 1}`, String(frac), String(windowSeconds),
    )) as [number, number]
    if (est > limit) {
      // Escalate: sustained abuse (3x the limit) earns a 10-minute ban.
      if (est > limit * 3) await redis.set(`rl:ban:${key}`, '1', 'EX', 600)
      return { limited: true, count: est, retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds * (1 - frac))) }
    }
    return { limited: false, count: est, retryAfterSeconds: windowSeconds }
  } catch {
    const count = memoryHit(`rl:${key}:${bucket}`, windowSeconds * 1000)
    return { limited: count > limit, count, retryAfterSeconds: windowSeconds }
  }
}

/** Credential-stuffing guard: counts failures per email AND per IP; success clears the email counter. */
export async function loginAttemptStatus(email: string, ip: string) {
  const [e, i] = await redis.mget(`login_fail:${email}`, `login_fail_ip:${ip}`)
  const byEmail = Number(e ?? 0), byIp = Number(i ?? 0)
  return { locked: byEmail >= 5 || byIp >= 30, byEmail, byIp }
}
export async function recordLoginFailure(email: string, ip: string) {
  await redis.multi()
    .incr(`login_fail:${email}`).expire(`login_fail:${email}`, 900)
    .incr(`login_fail_ip:${ip}`).expire(`login_fail_ip:${ip}`, 900)
    .exec()
}
export const clearLoginFailures = (email: string) => redis.del(`login_fail:${email}`)

/** Per-route budgets, always keyed by IP (attackers can't dodge by rotating accounts). */
export const SENSITIVE_PATH_LIMITS: Array<{ match: (p: string) => boolean; name: string; limit: number; windowSeconds: number }> = [
  { name: 'sign-in', match: (p) => p === '/api/sign-in', limit: 10, windowSeconds: 60 },
  { name: 'sign-up', match: (p) => p === '/api/sign-up', limit: 5, windowSeconds: 300 },
  { name: 'forgot-password', match: (p) => p.startsWith('/api/auth/'), limit: 5, windowSeconds: 300 },
  { name: 'admin-create', match: (p) => p === '/api/admin/user', limit: 5, windowSeconds: 600 },
  { name: 'upload', match: (p) => p.includes('/upload') || p.includes('/files'), limit: 120, windowSeconds: 60 },
  { name: 'bulk', match: (p) => p.startsWith('/api/cases/bulk'), limit: 10, windowSeconds: 60 },
]
