import { isIP } from 'node:net'
import { db } from '@/src/db'
import { authAuditLog } from '@/src/db/schema/auth-audit'
import { redis, guarded } from '@/src/lib/redis'
import { getClientIp } from '@/src/lib/security/client-ip'

/**
 * Security audit trail for authentication and account-security events.
 *
 * Design rules (deliberate):
 *  - FIRE-AND-FORGET: `logAuthEvent` returns synchronously and NEVER throws or rejects. An audit-table outage
 *    must not be able to block or fail a login, and the write is off the request's critical path.
 *  - NEVER log secrets: no passwords, no reset tokens, no session ids, no hashes. `details` is an allow-listed,
 *    size-capped bag of small scalars (reason codes, role from/to).
 *  - Untrusted input is normalised: email lower-cased + length-capped, IP validated as a real address
 *    (anything else -> NULL, so a spoofed header can't corrupt the inet column), User-Agent truncated.
 *  - The same row never tells the CLIENT why something failed — reasons live only here (e.g. unknown email vs
 *    wrong password), the HTTP response stays generic.
 *  - The table is append-only in the database (trigger), retained ~13 months (purge_auth_audit_log()).
 */

export type AuthEvent =
  | 'signin_ok'
  | 'signin_fail'          // details.reason: unknown_email | bad_password
  | 'signin_locked'        // too many failures (logged once per lockout window, not per blocked attempt)
  | 'signin_blocked'       // correct password but account pending/inactive
  | 'signout'
  | 'account_created'      // details.via: signup | admin | admin_bootstrap | subuser
  | 'account_deleted'
  | 'pw_reset_requested'   // details.known: whether the email matched an account (never shown to the client)
  | 'pw_reset_done'
  | 'pw_reset_invalid_token'
  | 'pw_changed_by_admin'  // actor_id = admin, user_id = affected account; all sessions revoked
  | 'role_changed'         // details.changes: { role?, status?, userType? } as { from, to }
  | 'sessions_revoked'

type Scalar = string | number | boolean | null
type Details = Record<string, Scalar | Record<string, Scalar | { from: Scalar; to: Scalar }>>

export type AuthEventInput = {
  event: AuthEvent
  userId?: string | null   // affected account
  actorId?: string | null  // who performed it when it isn't the account itself (admin actions)
  email?: string | null
  headers?: Headers        // request headers -> ip + user-agent
  details?: Details
}

const MAX_EMAIL = 254
const MAX_UA = 512

function clean(input: AuthEventInput) {
  const rawIp = input.headers ? getClientIp(input.headers) : null
  const ip = rawIp && isIP(rawIp) ? rawIp : null
  const ua = input.headers?.get('user-agent')?.slice(0, MAX_UA) || null
  const email = input.email ? input.email.trim().toLowerCase().slice(0, MAX_EMAIL) : null
  const details = input.details && JSON.stringify(input.details).length <= 2048 ? input.details : null
  return { userId: input.userId ?? null, actorId: input.actorId ?? null, email, event: input.event, ip, userAgent: ua, details }
}

export function logAuthEvent(input: AuthEventInput): void {
  let row: ReturnType<typeof clean>
  try { row = clean(input) } catch { return }
  void db.insert(authAuditLog).values(row as typeof authAuditLog.$inferInsert).catch((err) => {
    // Visible in logs/alerts, invisible to the user. Deliberately no retry: a retry storm during a DB incident
    // would make things worse, and the Redis counters still protect the account.
    // Drizzle wraps the driver error: the Postgres SQLSTATE lives on `cause`. (Log the code only — never row data.)
    const e = err as { code?: string; cause?: { code?: string; constraint_name?: string } }
    console.error('[auth-audit] write failed', { event: input.event, code: e?.cause?.code ?? e?.code, constraint: e?.cause?.constraint_name })
  })
}

/**
 * Lockout logging gate: record `signin_locked` once per window per email instead of once per blocked attempt,
 * so a password-guessing flood can't turn the audit table into a write-amplification vector.
 */
export async function shouldLogLockout(email: string): Promise<boolean> {
  try {
    return (await guarded(() => redis.set(`audit:locked:${email.trim().toLowerCase().slice(0, MAX_EMAIL)}`, '1', 'EX', 900, 'NX'))) === 'OK'
  } catch {
    return false
  }
}
