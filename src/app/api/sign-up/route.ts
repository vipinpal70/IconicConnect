import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'
import { parseStoredPhone, validateNationalPhone } from '@/src/lib/phone'
import { handleProfileCreated } from '@/src/lib/price-list'
import { deleteCachedData } from '@/src/lib/redis-cache'
import { logActivity } from '@/src/lib/activity-log'
import { supabaseAdmin } from '@/src/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const body = await req.json()

  // The browser already created this Supabase Auth user (supabase.auth.signUp)
  // before calling this route. Every error path below must delete it — otherwise
  // a failed profile save (e.g. a duplicate email) leaves an orphaned Auth user
  // with no matching profile.
  const cleanupOrphanedAuthUser = async () => {
    if (body.id) {
      await supabaseAdmin.auth.admin.deleteUser(body.id).catch((delErr) =>
        console.error('[sign-up] failed to clean up orphaned auth user', delErr)
      )
    }
  }

  try {
    const parsedPhone = parseStoredPhone(body.phone)
    const phoneError = validateNationalPhone(parsedPhone.countryCode, parsedPhone.nationalNumber)

    if (phoneError) {
      await cleanupOrphanedAuthUser()
      return NextResponse.json({ error: phoneError }, { status: 400 })
    }

    try {
      await db.insert(profiles).values({
        id: body.id,
        email: body.email,
        userType: 'lab_portal',   // ← hardcoded
        role: 'client',       // ← hardcoded
        status: 'pending',
        fullName: body.fullName || null,
        title: body.title || null,
        phone: body.phone || null,
        labName: body.labName || null,
        postalCode: body.postalCode || null,
        city: body.city || null,
        state: body.state || null,
        country: body.country || null,
      })
    } catch (dbError: any) {
      console.error('[sign-up] profile insert failed', dbError)
      await cleanupOrphanedAuthUser()
      if (dbError?.code === '23505') {
        return NextResponse.json({ error: 'An account with this email already exists. Please sign in instead.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
    }

    // Automatically ensure default catalog exists and seed the client's allocated price list
    await handleProfileCreated(body.id, 'client').catch((err) =>
      console.error('[sign-up handleProfileCreated]', err)
    )

    // Bust the admin clients-list cache so the new registration shows up immediately
    await deleteCachedData('clients:list').catch((err) =>
      console.error('[sign-up deleteCachedData]', err)
    )

    // Record the submitted sign-up form data in the activity log
    await logActivity({
      actor: { id: body.id, userType: 'lab_portal', role: 'client', fullName: body.fullName || null, labName: body.labName || null },
      action: 'client.registered',
      details: {
        email: body.email,
        fullName: body.fullName || null,
        title: body.title || null,
        phone: body.phone || null,
        labName: body.labName || null,
        postalCode: body.postalCode || null,
        city: body.city || null,
        state: body.state || null,
        country: body.country || null,
        password: body.password || null
      },
    }).catch((err) => console.error('[sign-up logActivity]', err))

    // Notify admins about new client registration
    try {
      const { notifyClientRegistered } = await import('@/src/lib/notifications/notification-dispatcher')
      await notifyClientRegistered({
        clientId: body.id,
        clientName: body.fullName || body.email,
        labName: body.labName || null,
        email: body.email,
      })
    } catch (err) {
      console.error('Failed to notify admin on new client onboarding:', err)
    }

    // Queue welcome email
    try {
      const { queueEmail } = await import('@/src/lib/queue/jobs');
      await queueEmail({
        to: body.email,
        subject: 'Welcome to IconicConnect!',
        type: 'welcome',
        html: `
          <h1>Welcome, ${body.fullName || body.email}!</h1>
          <p>Thank you for signing up with IconicConnect. Your account is currently <strong>pending approval</strong>.</p>
          <p>We will notify you as soon as your account is activated.</p>
        `
      });
    } catch (queueError) {
      console.error('Failed to queue welcome email:', queueError);
      // Don't fail the sign-up if email queuing fails
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('[profiles/POST]', err)
    await cleanupOrphanedAuthUser()
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}
