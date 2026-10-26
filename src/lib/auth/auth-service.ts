import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { authCredentials } from '@/src/db/schema/auth-credentials'
import { profiles } from '@/src/db/schema/profile'
import { destroyAllSessions } from './session'
import { hashPassword, verifyPassword } from './password-hash'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type SignInResult =
  | {
      ok: true
      userId: string
      role: string
      status: string
      createdBy: string | null
    }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'blocked'; status: string }

export async function signIn(emailInput: string, password: string): Promise<SignInResult> {
  const email = normalizeEmail(emailInput)
  const [row] = await db
    .select({
      userId: authCredentials.userId,
      email: authCredentials.email,
      passwordHash: authCredentials.passwordHash,
      bannedUntil: authCredentials.bannedUntil,
      deletedAt: authCredentials.deletedAt,
      role: profiles.role,
      status: profiles.status,
      createdBy: profiles.createdBy,
    })
    .from(authCredentials)
    .leftJoin(profiles, eq(profiles.id, authCredentials.userId))
    .where(eq(authCredentials.email, email))
    .limit(1)

  const verification = await verifyPassword(password, row?.passwordHash)
  if (!row || !row.role || !row.status || !verification.valid) {
    return { ok: false, reason: 'invalid' }
  }
  if (row.deletedAt || (row.bannedUntil && row.bannedUntil > new Date())) {
    return { ok: false, reason: 'invalid' }
  }
  if (row.status !== 'active') {
    return { ok: false, reason: 'blocked', status: row.status }
  }

  const passwordHash = verification.needsRehash
    ? await hashPassword(password)
    : row.passwordHash
  await db.update(authCredentials)
    .set({ passwordHash, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(authCredentials.userId, row.userId))

  return {
    ok: true,
    userId: row.userId,
    role: row.role,
    status: row.status,
    createdBy: row.createdBy,
  }
}

export async function createCredential(
  userId: string,
  emailInput: string,
  password: string,
): Promise<void> {
  const email = normalizeEmail(emailInput)
  await db.insert(authCredentials).values({
    userId,
    email,
    passwordHash: await hashPassword(password),
  })
}

export async function setPassword(userId: string, password: string): Promise<boolean> {
  const rows = await db.update(authCredentials)
    .set({
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(authCredentials.userId, userId))
    .returning({ userId: authCredentials.userId })

  if (!rows.length) return false
  await destroyAllSessions(userId)
  return true
}

export async function deleteCredential(userId: string): Promise<void> {
  await db.delete(authCredentials).where(eq(authCredentials.userId, userId))
  await destroyAllSessions(userId)
}
