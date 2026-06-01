import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/src/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
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
      return NextResponse.json(
        { error: error.message },
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
      }
    }

    return NextResponse.json(
      {
        success: true,
        user: data.user,
        session: data.session,
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
