import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { millingCenters } from '@/src/db/schema/milling';
import { supabaseAdmin } from '@/src/lib/supabase/admin';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and, desc } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';
import { queueEmail } from '@/src/lib/queue/jobs';

const MILLING_ROLES = ['milling_admin', 'milling_production', 'milling_support'] as const;

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  if (!profile || profile.role !== 'admin') return null;
  return profile;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const millingCenterId = searchParams.get('millingCenterId');

  try {
    const conditions = [eq(profiles.userType, 'milling_portal')];
    if (millingCenterId) conditions.push(eq(profiles.millingCenterId, millingCenterId));

    const users = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        email: profiles.email,
        role: profiles.role,
        status: profiles.status,
        millingCenterId: profiles.millingCenterId,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .where(and(...conditions))
      .orderBy(desc(profiles.createdAt));

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error fetching milling users:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const actorProfile = await requireAdmin();
  if (!actorProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { email, password, fullName, role, millingCenterId, phone } = body;

    if (!email || !password || !role || !millingCenterId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!MILLING_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid milling role' }, { status: 400 });
    }

    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, millingCenterId)).limit(1);
    if (!center) {
      return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 });
    }

    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { fullName, role, userType: 'milling_portal', millingCenterId },
    });

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message || 'Failed to create auth user' }, { status: 400 });
    }

    // 2. Create profile in database
    await db.insert(profiles).values({
      id: authData.user.id,
      email,
      fullName,
      role,
      userType: 'milling_portal',
      millingCenterId,
      phone,
      status: 'active',
    });

    // 3. Send credentials email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    await queueEmail({
      to: email,
      subject: 'Your IconicConnect Milling Portal Credentials',
      type: 'credentials',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#065f46;margin-bottom:4px;">Your Account is Ready</h2>
          <p style="color:#6b7280;font-size:14px;margin-top:0;">Welcome to the IconicConnect Milling Portal</p>
          <p style="color:#111827;">Hello <strong>${fullName || email}</strong>,</p>
          <p style="color:#374151;">An account has been created for you at <strong>${center.name}</strong> as <strong>${role.replace(/_/g, ' ')}</strong>. Use the credentials below to sign in.</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Login URL:</strong> <a href="${appUrl}/auth/sign-in" style="color:#059669;">${appUrl}/auth/sign-in</a></p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Email:</strong> ${email}</p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Password:</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;">${password}</code></p>
          </div>
          <p style="color:#6b7280;font-size:13px;">Please change your password after your first login.</p>
        </div>
      `,
    }).catch((err) => console.error('[milling_user.created] Failed to queue credentials email:', err));

    await logActivity({
      actor: actorProfile,
      action: 'milling_user.created',
      details: { userId: authData.user.id, email, fullName, role, millingCenterId },
    });

    return NextResponse.json({ success: true, user: authData.user });
  } catch (error) {
    console.error('Error creating milling user:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
