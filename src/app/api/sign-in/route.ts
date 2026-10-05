import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/src/lib/supabase/server'

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

    const supabase = await createClient()

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      // Same message for every failure so responses don't distinguish unknown email / wrong password / etc.
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Fetch profile to determine redirect URL and status
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_role, created_by, user_status')
      .eq('id', data.user.id)
      .single()

    if (profile && profile.user_status !== 'active') {
      // Don't leave a live session behind for a pending/suspended account.
      await supabase.auth.signOut().catch(() => {})
      return NextResponse.json(
        {
          success: false,
          isBlocked: true,
          message: profile.user_status === 'pending' 
            ? 'Your account is under review. Please wait for admin approval.' 
            : `Your account is ${profile.user_status}. Please contact support.`
        },
        { status: 200 }
      )
    }

    let redirectUrl = '/dashboard'
    if (profile) {
      switch (profile.user_role) {
        case 'admin':
          redirectUrl = '/admin/dashboard'
          break
        case 'client':
          redirectUrl = '/client/dashboard'
          break
        case 'subuser':
          redirectUrl = '/client/dashboard'
          break
        case 'qc':
        case 'designer':
        case 'account_manager':
          redirectUrl = '/dashboard'
          break
        case 'milling_admin':
        case 'milling_production':
        case 'milling_support':
          redirectUrl = '/milling/dashboard'
          break
      }
    }

    return NextResponse.json(
      {
        success: true,
        // The session is carried by the Supabase auth cookies set above; tokens are deliberately not echoed in the body.
        redirectUrl,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error('[sign-in POST]', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
