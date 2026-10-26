import { createHash } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { authCredentials, authRecoveryTokens } from '@/src/db/schema'
import { hashPassword } from '@/src/lib/auth/password-hash'
import { destroyAllSessions } from '@/src/lib/auth/session'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (
    typeof body?.token !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.token) ||
    typeof body.password !== 'string' ||
    body.password.length < 10 ||
    body.password.length > 256
  ) {
    return NextResponse.json({ error: 'Invalid or expired recovery link.' }, { status: 400 })
  }

  const tokenHash = createHash('sha256').update(body.token).digest('hex')
  const now = new Date()
  const [recovery] = await db.select({ userId: authRecoveryTokens.userId })
    .from(authRecoveryTokens)
    .where(and(
      eq(authRecoveryTokens.tokenHash, tokenHash),
      isNull(authRecoveryTokens.consumedAt),
      gt(authRecoveryTokens.expiresAt, now),
    ))
    .limit(1)
  if (!recovery) {
    return NextResponse.json({ error: 'Invalid or expired recovery link.' }, { status: 400 })
  }

  const passwordHash = await hashPassword(body.password)
  let userId: string | null = null
  try {
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

      const [updated] = await tx.update(authCredentials)
        .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
        .where(eq(authCredentials.userId, consumed.userId))
        .returning({ userId: authCredentials.userId })
      if (!updated) throw new Error('RECOVERY_CREDENTIAL_MISSING')
      userId = updated.userId
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'RECOVERY_CREDENTIAL_MISSING') {
      console.error('[auth reset-password] Recovery token references missing credential')
      return NextResponse.json({ error: 'Unable to update this account.' }, { status: 500 })
    }
    throw error
  }

  const recoveredUserId = userId
  if (!recoveredUserId) {
    return NextResponse.json({ error: 'Invalid or expired recovery link.' }, { status: 400 })
  }

  await destroyAllSessions(recoveredUserId)
  return NextResponse.json({ success: true })
}
