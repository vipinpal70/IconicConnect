import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, token } = body

    if (!email || !token) {
      return NextResponse.json({ error: 'Email and OTP token are required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email'
    })

    if (verifyError || !user) {
      return NextResponse.json({ error: verifyError?.message || 'Invalid or expired OTP token' }, { status: 401 })
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (profile.status === 'active') {
      return NextResponse.json({ success: true })
    }

    await db
      .update(profiles)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(profiles.id, user.id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[api/admin/activate POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

