import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { authCredentials, authRecoveryTokens, profiles } from '@/src/db/schema'

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null)
    if (typeof body !== 'object' || body === null || !('email' in body) || !('token' in body)) {
      return NextResponse.json({ error: 'Email and verification token are required' }, { status: 400 })
    }
    const { email, token } = body

    if (
      typeof email !== 'string' ||
      typeof token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    ) {
      return NextResponse.json({ error: 'Email and verification token are required' }, { status: 400 })
    }

    const tokenHash = createHash('sha256').update(token).digest('hex')
    const [recovery] = await db.select({
      userId: authRecoveryTokens.userId,
    }).from(authRecoveryTokens)
      .where(and(
        eq(authRecoveryTokens.tokenHash, tokenHash),
        isNull(authRecoveryTokens.consumedAt),
        gt(authRecoveryTokens.expiresAt, new Date()),
      ))
      .limit(1)
    if (!recovery) {
      return NextResponse.json({ error: 'Invalid or expired verification token' }, { status: 401 })
    }

    const [credential] = await db.select({
      userId: authCredentials.userId,
    }).from(authCredentials)
      .where(and(
        eq(authCredentials.userId, recovery.userId),
        sql`lower(${authCredentials.email}) = ${email.trim().toLowerCase()}`,
      ))
      .limit(1)
    if (!credential) {
      return NextResponse.json({ error: 'Invalid or expired verification token' }, { status: 401 })
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, credential.userId)).limit(1)

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date()
    let activated = false
    await db.transaction(async (tx) => {
      const [consumed] = await tx.update(authRecoveryTokens)
        .set({ consumedAt: now })
        .where(and(
          eq(authRecoveryTokens.tokenHash, tokenHash),
          isNull(authRecoveryTokens.consumedAt),
          gt(authRecoveryTokens.expiresAt, now),
        ))
        .returning({ userId: authRecoveryTokens.userId })
      if (!consumed) return

      const [updatedCredential] = await tx.update(authCredentials)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(eq(authCredentials.userId, credential.userId))
        .returning({ userId: authCredentials.userId })
      if (!updatedCredential) throw new Error('Activation credential no longer exists.')

      if (profile.status !== 'active') {
        await tx.update(profiles)
          .set({ status: 'active', updatedAt: now })
          .where(eq(profiles.id, credential.userId))
      }
      activated = true
    })
    if (!activated) {
      return NextResponse.json({ error: 'Invalid or expired verification token' }, { status: 401 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[api/admin/activate POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
