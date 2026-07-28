import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { supabaseAdmin } from '@/src/lib/supabase/admin'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import { logActivity } from '@/src/lib/activity-log'
import { queueEmail } from '@/src/lib/queue/jobs'

// POST /api/admin/milling/users/[id]/credentials — admin resets a milling
// portal user's password and emails them the new credentials.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const body = await req.json()
    const { password } = body

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    const [user] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    if (!user || user.userType !== 'milling_portal') {
      return NextResponse.json({ error: 'Milling user not found' }, { status: 404 })
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, { password })
    if (authError) {
      // The profile row exists in our DB, but Supabase Auth has no matching
      // login (e.g. it was removed directly in Supabase, or was never
      // created due to the bug this now guards against elsewhere).
      const message = /user not found/i.test(authError.message)
        ? `No login exists for ${user.email} in the authentication system — this profile is orphaned. Delete this user and re-add them instead of resetting.`
        : authError.message
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await queueEmail({
      to: user.email,
      subject: 'Your IconicConnect Milling Portal Password has been Reset',
      type: 'credentials',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#065f46;margin-bottom:4px;">Password Reset</h2>
          <p style="color:#111827;">Hello ${user.fullName || user.email},</p>
          <p style="color:#374151;">Your Milling Portal password has been reset by an administrator.</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Login URL:</strong> <a href="${appUrl}/auth/sign-in" style="color:#059669;">${appUrl}/auth/sign-in</a></p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Email:</strong> ${user.email}</p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>New Password:</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;">${password}</code></p>
          </div>
          <p style="color:#6b7280;font-size:13px;">Please change your password after logging in.</p>
        </div>
      `,
    }).catch((err) => console.error('[milling_user.password_reset] Failed to queue credentials email:', err))

    await logActivity({
      actor: auth.profile,
      action: 'milling_user.password_reset',
      details: { userId: id, email: user.email },
    }).catch((err) => console.error('[milling_user.password_reset logActivity]', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/milling/users/[id]/credentials POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}