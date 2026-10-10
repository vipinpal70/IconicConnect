import { NextRequest, NextResponse } from 'next/server'
import { consumeResetToken, setPassword } from '@/src/lib/auth/auth-service'
import { validatePasswordStrength } from '@/src/lib/security/password'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token : ''
  const weak = validatePasswordStrength(body?.password)
  if (weak) return NextResponse.json({ error: weak }, { status: 400 })

  // Single-use: the token is deleted by GETDEL even if the password step then fails.
  const userId = await consumeResetToken(token)
  if (!userId) return NextResponse.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, { status: 400 })

  await setPassword(userId, body.password)
  return NextResponse.json({ success: true })
}
