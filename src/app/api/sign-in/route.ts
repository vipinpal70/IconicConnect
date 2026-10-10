import { logAuthEvent, shouldLogLockout } from '@/src/lib/auth/audit'
import { NextRequest, NextResponse } from 'next/server'
import { signIn, normalizeEmail } from '@/src/lib/auth/auth-service'
import { SESSION_COOKIE, sessionCookieOptions } from '@/src/lib/auth/session'
import { isRedisProblem } from '@/src/lib/redis'
import { getClientIp } from '@/src/lib/security/client-ip'
import { clearLoginFailures, loginAttemptStatus, recordLoginFailure } from '@/src/lib/security/rate-limit'

const HOME: Record<string, string> = {
  admin: '/admin/dashboard',
  client: '/client/dashboard',
  subuser: '/client/dashboard',
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const { email, password } = body ?? {}
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || email.length > 254 || password.length > 256) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const ip = getClientIp(req.headers)
    const key = normalizeEmail(email)

    // Lock BEFORE hashing so a flood of guesses can't be used to burn CPU on argon2 either.
    const attempts = await loginAttemptStatus(key, ip)
    if (attempts.locked) {
      if (await shouldLogLockout(key)) logAuthEvent({ event: 'signin_locked', email: key, headers: req.headers, details: { byEmail: attempts.byEmail, byIp: attempts.byIp } })
      return NextResponse.json(
        { error: 'Too many failed attempts. Please wait 15 minutes or reset your password.' },
        { status: 429, headers: { 'Retry-After': '900' } },
      )
    }

    const result = await signIn(email, password)

    if (!result.ok && result.reason === 'invalid') {
      await recordLoginFailure(key, ip)
      logAuthEvent({ event: 'signin_fail', userId: result.userId, email: key, headers: req.headers, details: { reason: result.why } })
      // Same message for unknown email / wrong password.
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    await clearLoginFailures(key)

    if (!result.ok) {
      logAuthEvent({ event: 'signin_blocked', userId: result.userId, email: key, headers: req.headers, details: { status: result.status } })
      return NextResponse.json({
        success: false,
        isBlocked: true,
        message: result.status === 'pending'
          ? 'Your account is under review. Please wait for admin approval.'
          : `Your account is ${result.status}. Please contact support.`,
      })
    }

    logAuthEvent({ event: 'signin_ok', userId: result.userId, email: key, headers: req.headers, details: { role: result.role } })
    const response = NextResponse.json({ success: true, redirectUrl: HOME[result.role] ?? '/dashboard' })
    response.cookies.set(SESSION_COOKIE, result.sid, sessionCookieOptions)
    return response
  } catch (err) {
    console.error('[sign-in POST]', (err as Error)?.message)
    if (isRedisProblem(err)) return NextResponse.json({ error: 'Sign-in is temporarily unavailable. Please try again in a few seconds.' }, { status: 503, headers: { 'Retry-After': '10' } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
