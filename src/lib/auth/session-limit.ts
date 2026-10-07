import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Hard cap on how long a login stays valid, regardless of Supabase token refreshes.
 *
 * Supabase refresh tokens keep a session alive indefinitely, so the app stamps the moment of sign-in in a
 * signed, httpOnly cookie and src/proxy.ts rejects any session whose stamp is older than
 * SESSION_MAX_AGE_SECONDS (or missing/forged). The HMAC stops a user extending their own session by editing
 * the cookie. Sessions that predate this cookie have no stamp, so they are asked to sign in once.
 */
export const LOGIN_STAMP_COOKIE = 'iconic_login_at'
export const SESSION_MAX_AGE_SECONDS = 7 * 60 * 60

function secret(): string {
  const s = process.env.SESSION_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('SESSION_COOKIE_SECRET (or SUPABASE_SERVICE_ROLE_KEY) must be set')
  return s
}

function sign(issuedAtMs: string): string {
  return createHmac('sha256', secret()).update(issuedAtMs).digest('hex')
}

export function createLoginStamp(now = Date.now()): string {
  const ts = String(now)
  return `${ts}.${sign(ts)}`
}

export function isLoginStampValid(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false
  const [ts, sig] = value.split('.')
  if (!ts || !sig || !/^\d+$/.test(ts)) return false
  const expected = sign(ts)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  const age = now - Number(ts)
  return age >= -60_000 && age < SESSION_MAX_AGE_SECONDS * 1000
}
