import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

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

