import { NextRequest, NextResponse } from 'next/server'
import {
  destroySession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/src/lib/auth/session'

export async function POST(request: NextRequest) {
  try {
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value)
    const response = NextResponse.json({ success: true })
    response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 })
    return response
  } catch (error) {
    console.error('[auth sign-out]', error)
    return NextResponse.json({ error: 'Unable to sign out right now.' }, { status: 503 })
  }
}
