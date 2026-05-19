import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { supabaseAdmin } from '@/src/lib/supabase/admin';
import { createClient } from '@/src/lib/supabase/server';
import { eq, desc } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';

// Helper to check if current user is admin
async function isAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const results = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  const profile = results[0];

  return profile?.role === 'admin';
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
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

    // 3. Send email with credentials via Queue
    const { queueEmail } = await import('@/src/lib/queue/jobs');
    await queueEmail({
      to: email,
      subject: 'Your IconicConnect Credentials',
      type: 'credentials',
      html: `
        <h1>Your Account is Ready</h1>
        <p>Hello ${fullName || email},</p>
        <p>An account has been created for you on IconicConnect.</p>
        <p><strong>Login URL:</strong> http://localhost:3000/auth/sign-in</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Password:</strong> ${password}</p>
        <p>Please change your password after your first login.</p>
      `
    });

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
