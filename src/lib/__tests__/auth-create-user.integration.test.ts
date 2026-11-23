/**
 * createUserWithProfile against a real Postgres: duplicate emails and lab names must come back as the
 * right typed errors (they used to surface as a generic 500). Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… npx vitest run auth-create-user
 *
 * Creates throwaway users and removes them. Never point this at production.
 */
import { afterAll, describe, expect, it } from 'vitest'

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('createUserWithProfile (database)', async () => {
  const { db } = await import('@/src/db')
  const { eq, inArray } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { createUserWithProfile, EmailTakenError, LabNameTakenError } = await import('@/src/lib/auth/auth-service')

  const ids: string[] = []
  const tag = crypto.randomUUID().slice(0, 8)
  const lab = (labName: string) => ({ userType: 'lab_portal' as const, role: 'client' as const, status: 'pending' as const, fullName: 'Test', labName })

  afterAll(async () => {
    if (ids.length) await db.delete(users).where(inArray(users.id, ids))
  })

  it('creates a user once, then reports the same email (any case) as EmailTakenError', async () => {
    const email = `support-test-dup-${tag}@example.invalid`
    ids.push((await createUserWithProfile({ email, password: 'Str0ng!Passw0rd', profile: lab(`Dup Lab ${tag}`) })).id)
    await expect(
      createUserWithProfile({ email: email.toUpperCase(), password: 'Str0ng!Passw0rd', profile: lab(`Other Lab ${tag}`) }),
    ).rejects.toBeInstanceOf(EmailTakenError)
  })

  it('reports a taken lab name as LabNameTakenError, not as an email clash', async () => {
    await expect(
      createUserWithProfile({ email: `support-test-dup2-${tag}@example.invalid`, password: 'Str0ng!Passw0rd', profile: lab(`DUP LAB ${tag}`) }),
    ).rejects.toBeInstanceOf(LabNameTakenError)
  })

  it('leaves no half-created account behind after a clash', async () => {
    // The lab-name clash happens on the profile insert, after the user row was written in the same
    // transaction: that user row must have been rolled back
    const leftovers = await db.select({ id: users.id }).from(users).where(eq(users.email, `support-test-dup2-${tag}@example.invalid`))
    expect(leftovers).toHaveLength(0)
    void profiles
  })
})
