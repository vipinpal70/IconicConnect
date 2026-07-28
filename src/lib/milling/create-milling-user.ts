import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { supabaseAdmin } from '@/src/lib/supabase/admin'
import { queueEmail } from '@/src/lib/queue/jobs'
import { logActivity } from '@/src/lib/activity-log'
import type { Profile } from '@/src/db/schema/profile'

export const MILLING_ROLES = ['milling_admin', 'milling_production', 'milling_support'] as const
export type MillingRole = (typeof MILLING_ROLES)[number]

export interface CreateMillingUserInput {
  email: string
  password: string
  fullName?: string | null
  role: MillingRole
  millingCenterId: string
  centerName: string
  phone?: string | null
  actor: Pick<Profile, 'id' | 'userType' | 'role' | 'fullName' | 'labName'>
}

/**
 * Creates the Supabase auth user + profile row for a milling portal login and
 * emails the credentials. Shared by centre onboarding (first login) and the
 * milling users admin API (adding a login to an existing centre).
 */
export async function createMillingUser(input: CreateMillingUserInput) {
  const { email, password, fullName, role, millingCenterId, centerName, phone, actor } = input

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { fullName, role, userType: 'milling_portal', millingCenterId },
  })

  if (authError || !authData.user) {
    throw new Error(authError?.message || 'Failed to create auth user')
  }

  await db.insert(profiles).values({
    id: authData.user.id,
    email,
    fullName,
    role,
    userType: 'milling_portal',
    millingCenterId,
    phone,
    status: 'active',
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  await queueEmail({
    to: email,
    subject: 'Your IconicConnect Milling Portal Credentials',
    type: 'credentials',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2 style="color:#065f46;margin-bottom:4px;">Your Account is Ready</h2>
        <p style="color:#6b7280;font-size:14px;margin-top:0;">Welcome to the IconicConnect Milling Portal</p>
        <p style="color:#111827;">Hello <strong>${fullName || email}</strong>,</p>
        <p style="color:#374151;">An account has been created for you at <strong>${centerName}</strong> as <strong>${role.replace(/_/g, ' ')}</strong>. Use the credentials below to sign in.</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Login URL:</strong> <a href="${appUrl}/auth/sign-in" style="color:#059669;">${appUrl}/auth/sign-in</a></p>
          <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Email:</strong> ${email}</p>
          <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Password:</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;">${password}</code></p>
        </div>
        <p style="color:#6b7280;font-size:13px;">Please change your password after your first login.</p>
      </div>
    `,
  }).catch((err) => console.error('[milling_user.created] Failed to queue credentials email:', err))

  await logActivity({
    actor,
    action: 'milling_user.created',
    details: { userId: authData.user.id, email, fullName, role, millingCenterId },
  }).catch((err) => console.error('[milling_user.created logActivity]', err))

  return authData.user
}