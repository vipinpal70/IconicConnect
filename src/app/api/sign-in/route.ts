import { NextRequest, NextResponse } from 'next/server'
import { signIn } from '@/src/lib/auth/auth-service'
import {
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/src/lib/auth/session'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = body

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || email.length > 254 || password.length > 256) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    const result = await signIn(email, password)
    if (!result.ok && result.reason === 'invalid') {
      // Same message for every failure so responses don't distinguish unknown email / wrong password / etc.
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          isBlocked: true,
          message: result.status === 'pending'
            ? 'Your account is under review. Please wait for admin approval.' 
            : `Your account is ${result.status}. Please contact support.`
        },
        { status: 200 }
      )
    }

    let redirectUrl = '/dashboard'
    switch (result.role) {
      case 'admin':
        redirectUrl = '/admin/dashboard'
        break
      case 'client':
      case 'subuser':
        redirectUrl = '/client/dashboard'
        break
      case 'qc':
      case 'designer':
      case 'account_manager':
      case 'consultant':
        redirectUrl = '/dashboard'
        break
      case 'milling_admin':
      case 'milling_production':
      case 'milling_support':
        redirectUrl = '/milling/dashboard'
        break
    }

    const response = NextResponse.json(
      {
        success: true,
        redirectUrl,
      },
      { status: 200 }
    )

    response.cookies.set(SESSION_COOKIE, await createSession(result.userId), sessionCookieOptions)
    return response
  } catch (err) {
    console.error('[sign-in POST]', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
