import { createSetPasswordLink, setPasswordBlock } from '@/src/lib/security/set-password-link'
import { escapeHtml } from '@/src/lib/security/html'
import { validatePasswordStrength } from '@/src/lib/security/password'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { supabaseAdmin } from '@/src/lib/supabase/admin'
import { logActivity } from '@/src/lib/activity-log'
import { queueEmailSafely } from '@/src/lib/queue/jobs'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile }
}

// POST /api/admin/clients/[id]/credentials — admin sets a client's login
// password (typed manually or auto-generated on the frontend) and emails
// them the new credentials.
//
// Updates the local credential record and revokes all Redis-backed sessions.
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
    const passwordError = validatePasswordStrength(password)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }

    const [client] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    if (!client || client.role !== 'client') {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, { password })
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const setLink = await createSetPasswordLink(client.email)
    const { queued: emailQueued, error: emailError } = await queueEmailSafely({
      to: client.email,
      subject: 'Your IconicConnect Password has been Reset',
      type: 'credentials',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#065f46;margin-bottom:4px;">Password Reset</h2>
          <p style="color:#111827;">Hello ${escapeHtml(client.fullName || client.labName || client.email)},</p>
          <p style="color:#374151;">Your IconicConnect password has been reset by an administrator.</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Login URL:</strong> <a href="${appUrl}/auth/sign-in" style="color:#059669;">${appUrl}/auth/sign-in</a></p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Email:</strong> ${escapeHtml(client.email)}</p>
            ${setPasswordBlock(setLink, appUrl)}
          </div>
          
        </div>
      `,
    })
    if (!emailQueued) {
      console.error('[client.password_reset] Failed to queue credentials email:', emailError)
    }

    await logActivity({
      actor: auth.profile,
      action: 'client.password_reset',
      details: { clientId: id, labName: client.labName, email: client.email, emailQueued },
    }).catch((err) => console.error('[client.password_reset logActivity]', err))

    return NextResponse.json({ success: true, emailQueued })
  } catch (error) {
    console.error('[admin/clients/[id]/credentials POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
