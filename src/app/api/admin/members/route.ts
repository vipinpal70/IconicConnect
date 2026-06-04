import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { supabaseAdmin } from '@/src/lib/supabase/admin';
import { createClient } from '@/src/lib/supabase/server';
import { eq, desc } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { NotificationService } from '@/src/lib/notifications/notification-service';
import { NotificationType } from '@/src/lib/notifications/notification-events';
import { queueEmail } from '@/src/lib/queue/jobs';
import { handleProfileCreated } from '@/src/lib/price-list';

// Helper to check if current user is admin
async function isAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const results = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  const profile = results[0];

  return profile?.role === 'admin';
}

// Helper to check if current user has portal access (admin, qc, designer, account_manager)
async function isPortalUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const results = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  const profile = results[0];

  return profile && isValidRoleForType('admin_portal', profile.role as any);
}

export async function GET(req: NextRequest) {
  if (!(await isPortalUser())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  try {
    const query = db.select().from(profiles).orderBy(desc(profiles.createdAt));
    
    // Exclude client and subuser roles from the team list
    const members = (await query).filter(m => !['client', 'subuser'].includes(m.role));
    
    const filteredMembers = status 
      ? members.filter(m => m.status === status)
      : members;

    console.log("GET /api/admin/members - returning members:", filteredMembers.map(m => ({ id: m.id, role: m.role, status: m.status, fullName: m.fullName })));
    return NextResponse.json(filteredMembers);
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const [actorProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);

  if (!actorProfile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  if (actorProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { email, password, fullName, role, userType, phone } = body;

    if (!email || !password || !role || !userType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { fullName, role, userType },
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
      userType,
      phone,
      status: 'active',
    });

    // Automatically seed default catalog and client price list
    await handleProfileCreated(authData.user.id, role, user.id).catch((err) =>
      console.error('[admin/members handleProfileCreated]', err)
    );

    // 2.5 Trigger Welcome in-app notification
    NotificationService.dispatch({
      type: NotificationType.WELCOME,
      actorUserId: user.id,
      targetUserId: authData.user.id,
      title: 'Welcome to the Team!',
      message: `Welcome to the IconicConnect team, ${fullName || email}! You have been onboarded as ${role.replace(/_/g, ' ')}.`,
      link: '/dashboard',
      metadata: { role },
    }).catch((err) => console.error('[member.created] Failed to send welcome notification:', err));

    // 3. Send credentials email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    await queueEmail({
      to: email,
      subject: 'Your IconicConnect Login Credentials',
      type: 'credentials',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#065f46;margin-bottom:4px;">Your Account is Ready</h2>
          <p style="color:#6b7280;font-size:14px;margin-top:0;">Welcome to IconicConnect</p>
          <p style="color:#111827;">Hello <strong>${fullName || email}</strong>,</p>
          <p style="color:#374151;">An account has been created for you on IconicConnect as <strong>${role.replace(/_/g, ' ')}</strong>. Use the credentials below to sign in.</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Login URL:</strong> <a href="${appUrl}/auth/sign-in" style="color:#059669;">${appUrl}/auth/sign-in</a></p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Email:</strong> ${email}</p>
            <p style="margin:4px 0;font-size:14px;color:#374151;"><strong>Password:</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;">${password}</code></p>
          </div>
          <p style="color:#6b7280;font-size:13px;">Please change your password after your first login.</p>
        </div>
      `,
    }).catch((err) => console.error('[member.created] Failed to queue credentials email:', err));

    await logActivity({
      actor: actorProfile,
      action: 'member.created',
      details: {
        memberId: authData.user.id,
        email,
        fullName,
        role,
        userType,
        phone,
      },
    });

    return NextResponse.json({ success: true, user: authData.user });
  } catch (error) {
    console.error('Error creating member:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
