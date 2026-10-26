import { createHash } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { authRecoveryTokens } from '@/src/db/schema'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return NextResponse.redirect(new URL('/auth/reset-password?error=Invalid%20recovery%20link.', request.url))
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const [recovery] = await db.select({ tokenHash: authRecoveryTokens.tokenHash })
    .from(authRecoveryTokens)
    .where(and(
      eq(authRecoveryTokens.tokenHash, tokenHash),
      isNull(authRecoveryTokens.consumedAt),
      gt(authRecoveryTokens.expiresAt, new Date()),
    ))
    .limit(1)

  const destination = recovery
    ? `/auth/reset-password?token=${encodeURIComponent(token)}`
    : '/auth/reset-password?error=This%20recovery%20link%20is%20invalid%20or%20expired.'
  const response = NextResponse.redirect(new URL(destination, request.url))
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
