import { createHash, randomBytes } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { users, profiles, type NewProfile } from '@/src/db/schema/profile'
import { redis, guarded } from '@/src/lib/redis'
import { hashPassword, verifyPassword } from './password-hash'
import { createSession, destroyAllSessions } from './session'

/**
 * Replaces supabase.auth.* / supabase.auth.admin.*. Everything is one Postgres + one Redis call away —
 * no network hop to a separate auth provider.
 */

export const normalizeEmail = (e: string) => e.trim().toLowerCase()

export type SignInResult =
  | { ok: true; sid: string; userId: string; role: string; status: string; clientId: string | null }
  // `why`/`userId` are for the audit log ONLY — never put them in an HTTP response (no account enumeration).
  | { ok: false; reason: 'invalid'; why: 'unknown_email' | 'bad_password'; userId: string | null }
  | { ok: false; reason: 'blocked'; status: string; userId: string }

/** One indexed read (users ⨝ profiles by PK) → verify → one Redis write. */
export async function signIn(emailRaw: string, password: string): Promise<SignInResult> {
  const email = normalizeEmail(emailRaw)
  const [row] = await db
    .select({
      id: users.id, email: users.email, hash: users.passwordHash,
      role: profiles.role, userType: profiles.userType, status: profiles.status, clientId: profiles.clientId,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.id, users.id))
    .where(eq(users.email, email))
    .limit(1)

  const verdict = await verifyPassword(password, row?.hash ?? null)
  if (!row) return { ok: false, reason: 'invalid', why: 'unknown_email', userId: null }
  if (!verdict.ok || !row.role) return { ok: false, reason: 'invalid', why: 'bad_password', userId: row.id }
  if (row.status !== 'active') return { ok: false, reason: 'blocked', status: row.status ?? 'pending', userId: row.id }

  if (verdict.needsRehash) {
    // Legacy bcrypt (migrated from Supabase) → argon2id, transparently.
    await db.update(users).set({ passwordHash: await hashPassword(password), lastLoginAt: new Date() }).where(eq(users.id, row.id))
  } else {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id))
  }

  const { sid } = await createSession({
    userId: row.id, email: row.email, role: row.role, userType: row.userType!, clientId: row.clientId, status: row.status,
  })
  return { ok: true, sid, userId: row.id, role: row.role, status: row.status, clientId: row.clientId }
}

export class EmailTakenError extends Error { constructor() { super('A user with this email already exists.') } }

function isUniqueViolation(e: unknown) {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

/**
 * Creates the credential row AND the profile in one transaction — no orphaned auth user is possible,
 * so none of the old "delete the auth user if the profile insert fails" cleanup is needed.
 * `clientId` is derived here: client → own id, subuser → given parent, staff → null.
 */
export async function createUserWithProfile(
  input: { email: string; password: string; id?: string; profile: Omit<NewProfile, 'id' | 'clientId'> & { clientId?: string | null } },
) {
  const id = input.id ?? crypto.randomUUID()
  const passwordHash = await hashPassword(input.password)
  const role = input.profile.role
  const clientId = role === 'client' ? id : role === 'subuser' ? (input.profile.clientId ?? null) : null
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id, email: normalizeEmail(input.email), passwordHash })
      await tx.insert(profiles).values({ ...input.profile, id, clientId })
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw new EmailTakenError()
    throw e
  }
  return { id }
}

/** Admin set / user reset. Revokes every session so a stolen session can't outlive a password change. */
export async function setPassword(userId: string, newPassword: string) {
  await db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() })
    .where(eq(users.id, userId))
  await destroyAllSessions(userId)
}

/** Profile is removed by ON DELETE CASCADE. */
export async function deleteUser(userId: string) {
  await destroyAllSessions(userId)
  await db.delete(users).where(eq(users.id, userId))
}

/* ── password reset tokens: random, hashed at rest in Redis, single-use (GETDEL), 1 h ── */
const RESET_TTL = 3600
const resetKey = (t: string) => `pw_reset:${createHash('sha256').update(t).digest('hex')}`

export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await guarded(() => redis.set(resetKey(token), userId, 'EX', RESET_TTL))
  return token
}
export async function consumeResetToken(token: string): Promise<string | null> {
  if (!token || token.length > 100) return null
  return guarded(() => redis.getdel(resetKey(token)))
}

export async function findUserIdByEmail(emailRaw: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizeEmail(emailRaw))).limit(1)
  return u?.id ?? null
}

/** Email lives only in `users`. Single-row lookup by PK for cold paths (emails, audit details). */
export async function getEmail(userId: string | null | undefined): Promise<string> {
  if (!userId) return ''
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  return u?.email ?? ''
}

/** Batch variant: one query for N ids. */
export async function getEmails(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids))
  return new Map(rows.map((r) => [r.id, r.email]))
}
