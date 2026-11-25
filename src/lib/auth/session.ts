import { createHash, randomBytes } from 'node:crypto'
import { redis, guarded } from '@/src/lib/redis'
import { publishSessionCheck } from '@/src/lib/live/publish'

/**
 * Opaque-cookie sessions stored in Redis. One GET per request resolves the user AND the authz facts
 * (role, effective clientId, status), so most requests need no Postgres read and no auth network hop.
 * Absolute 7 h lifetime (no sliding renewal) — same policy the Supabase login-stamp enforced.
 */
export const SESSION_COOKIE = 'iconic_sid'
export const SESSION_TTL_SECONDS = 7 * 60 * 60

export type SessionData = {
  userId: string
  email: string
  role: string
  userType: string
  /** Effective lab: client → own id, subuser → parent client, staff → null. */
  clientId: string | null
  status: string
  csrf: string
  createdAt: number
}

const sessKey = (sid: string) => `sess:${createHash('sha256').update(sid).digest('hex')}`
const userKey = (userId: string) => `user_sess:${userId}`

export async function createSession(data: Omit<SessionData, 'csrf' | 'createdAt'>) {
  const sid = randomBytes(32).toString('base64url')
  const full: SessionData = { ...data, csrf: randomBytes(16).toString('base64url'), createdAt: Date.now() }
  const key = sessKey(sid)
  await guarded(() => redis.multi()
    .set(key, JSON.stringify(full), 'EX', SESSION_TTL_SECONDS)
    .sadd(userKey(data.userId), key)
    .expire(userKey(data.userId), SESSION_TTL_SECONDS)
    .exec())
  return { sid, session: full }
}

export async function getSession(sid: string | undefined): Promise<SessionData | null> {
  if (!sid || sid.length > 64) return null
  const raw = await guarded(() => redis.get(sessKey(sid)))
  return raw ? (JSON.parse(raw) as SessionData) : null
}

/** Which of these sessions still exist; null when Redis can't say. */
export async function aliveSessions(sids: string[]): Promise<boolean[] | null> {
  if (sids.length === 0) return []
  try {
    return (await redis.mget(sids.map(sessKey))).map((v) => v !== null)
  } catch {
    return null
  }
}

export async function destroySession(sid: string | undefined, userId?: string) {
  if (!sid) return
  const key = sessKey(sid)
  const m = redis.multi().del(key)
  if (userId) m.srem(userKey(userId), key)
  await guarded(() => m.exec())
  if (userId) await publishSessionCheck(userId) // closes this session's live connection
}

/** Revoke every device — call on password reset, suspension and role/clientId change. */
export async function destroyAllSessions(userId: string) {
  const keys = await guarded(() => redis.smembers(userKey(userId)))
  if (keys.length) await guarded(() => redis.del(...keys))
  await guarded(() => redis.del(userKey(userId)))
  await publishSessionCheck(userId) // closes their live connections at once
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
}
