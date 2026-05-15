import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if the requester is an admin
    const [adminProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!adminProfile || adminProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { clientId } = await req.json()
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
    }

    // Fetch client email before update
    const [clientProfile] = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1);
    if (!clientProfile) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Update client status to active
    await db.update(profiles)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(profiles.id, clientId))

    // Queue Notifications
    try {
      // 1. Email Notification
      const { queueEmail } = await import('@/src/lib/queue/jobs');
      await queueEmail({
        to: clientProfile.email,
        subject: 'Your IconicConnect Account has been Approved!',
        type: 'approval',
        html: `
          <h1>Account Approved!</h1>
          <p>Hello ${clientProfile.fullName || clientProfile.email},</p>
          <p>Great news! Your IconicConnect account has been approved and is now active.</p>
          <p>You can now log in and access all features of the portal.</p>
          <p><strong>Login URL:</strong> http://localhost:3000/auth/sign-in</p>
        `
      });

      // 2. In-app Notification
      const { notifications } = await import('@/src/db/schema/notification');
      await db.insert(notifications).values({
        userId: clientId,
        title: 'Account Approved',
        message: 'Your account has been approved. Welcome to IconicConnect!',
        type: 'approval',
      });
    } catch (notifyError) {
      console.error('Failed to send approval notifications:', notifyError);
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/clients/approve POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
