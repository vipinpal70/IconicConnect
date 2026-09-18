import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { supabaseAdmin } from '@/src/lib/supabase/admin'
import { logActivity } from '@/src/lib/activity-log'
import { queueEmail } from '@/src/lib/queue/jobs'

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
// Tries the official Supabase Admin API first. That call only works when
// SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL point at the same
// Supabase project the client's auth user actually lives in — which isn't
// always true for client accounts in this repo (see the docstring in
// scripts/set-client-password.ts, this route's logic mirrors it). Falls back
// to updating auth.users.encrypted_password directly using the same bcrypt
// scheme Supabase's own GoTrue uses ($2a$10$..., via pgcrypto), and revokes
// the client's existing sessions so the old password stops working anywhere.
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
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const [client] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    if (!client || client.role !== 'client') {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, { password })

    if (authError) {
      // Fall back to a direct database update — see the file-level comment.
      try {
        const result = await db.execute(sql`
          UPDATE auth.users
          SET encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf', 10)),
              updated_at = now()
          WHERE id = ${id}
          RETURNING id
        `)
        const resultShape = result as unknown as { rows?: unknown[] } & unknown[]
        const updatedRows = Array.isArray(result) ? resultShape : (resultShape.rows ?? resultShape)
        if (!updatedRows || (updatedRows as unknown[]).length === 0) {
          return NextResponse.json(
            { error: `No matching login found for ${client.email} in the authentication system.` },
            { status: 400 }
          )
        }
      } catch (dbError) {
        console.error('[admin/clients/[id]/credentials] direct DB fallback failed', dbError)
        return NextResponse.json({ error: authError.message || 'Failed to update password' }, { status: 400 })
      }

      // Revoke existing sessions so the old password/session can't keep working.
      await db.execute(sql`DELETE FROM auth.sessions WHERE user_id = ${id}`)
        .catch((err) => console.error('[admin/clients/[id]/credentials] session revoke failed', err))
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await queueEmail({
      to: client.email,
      subject: 'Your IconicConnect Password has been Reset',
      type: 'credentials',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#065f46;margin-bottom:4px;">Password Reset</h2>
          <p style="color:#111827;">Hello ${client.fullName || client.labName || client.email},</p>
          <p style="color:#374151;">Your IconicConnect password has been reset by an administrator.</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Login URL:</strong> <a href="${appUrl}/auth/sign-in" style="color:#059669;">${appUrl}/auth/sign-in</a></p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Email:</strong> ${client.email}</p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>New Password:</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;">${password}</code></p>
          </div>
          <p style="color:#6b7280;font-size:13px;">Please change your password after logging in.</p>
        </div>
      `,
    }).catch((err) => console.error('[client.password_reset] Failed to queue credentials email:', err))

    await logActivity({
      actor: auth.profile,
      action: 'client.password_reset',
      details: { clientId: id, labName: client.labName, email: client.email },
    }).catch((err) => console.error('[client.password_reset logActivity]', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/clients/[id]/credentials POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
