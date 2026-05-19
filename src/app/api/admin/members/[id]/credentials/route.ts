import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { supabaseAdmin } from '@/src/lib/supabase/admin';
import { createClient } from '@/src/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    const { password } = body;

    if (!password) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    // 1. Get member email and name
    const results = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
    const profile = results[0];

    if (!profile) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // 2. Update password in Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
      password,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    // 3. Send email with new credentials via Queue
    const { queueEmail } = await import('@/src/lib/queue/jobs');
    await queueEmail({
      to: profile.email,
      subject: 'Your IconicConnect Password has been Reset',
      type: 'credentials',
      html: `
        <h1>New Password Generated</h1>
        <p>Hello ${profile.fullName || profile.email},</p>
        <p>Your password for IconicConnect has been reset by an administrator.</p>
        <p><strong>Login URL:</strong> http://localhost:3000/auth/sign-in</p>
        <p><strong>Email:</strong> ${profile.email}</p>
        <p><strong>New Password:</strong> ${password}</p>
        <p>Please change your password after logging in.</p>
      `
    });

    await logActivity({
      actor: actorProfile,
      action: 'member.password_reset',
      details: {
        memberId: id,
        email: profile.email,
        role: profile.role,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error resetting credentials:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
