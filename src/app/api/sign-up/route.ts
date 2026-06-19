import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'
import { parseStoredPhone, validateNationalPhone } from '@/src/lib/phone'
import { handleProfileCreated } from '@/src/lib/price-list'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsedPhone = parseStoredPhone(body.phone)
    const phoneError = validateNationalPhone(parsedPhone.countryCode, parsedPhone.nationalNumber)

    if (phoneError) {
      return NextResponse.json({ error: phoneError }, { status: 400 })
    }

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

    // Automatically ensure default catalog exists and seed the client's allocated price list
    await handleProfileCreated(body.id, 'client').catch((err) =>
      console.error('[sign-up handleProfileCreated]', err)
    )

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
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}
