import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { supabaseAdmin } from '@/src/lib/supabase/admin';
import { createClient } from '@/src/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';

type MemberUpdateData = {
  fullName?: string
  role?: string
  status?: string
  phone?: string
  title?: string
  userType?: string
  updatedAt: Date
}

type AuthMetadataUpdate = {
  fullName?: string
  role?: string
  userType?: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get current user's profile to check role
  const [currentProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);

  if (!currentProfile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }
  
  const isAdmin = currentProfile?.role === 'admin';
  const isSelf = user.id === id;

  console.log(`[api/member/GET] Request by ${user.email}. isAdmin: ${isAdmin}, isSelf: ${isSelf}, targetId: ${id}`);

  if (!isAdmin && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const results = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
    const profile = results[0];

    if (!profile) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (error) {
    console.error('Error fetching member:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [currentProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  const isAdmin = currentProfile?.role === 'admin';
  const isSelf = user.id === id;

  console.log(`[api/member/PATCH] Request by ${user.email}. isAdmin: ${isAdmin}, isSelf: ${isSelf}, targetId: ${id}`);

  if (!isAdmin && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { fullName, role, status, phone, title, userType } = body;

    const updateData: MemberUpdateData = {
      fullName,
      phone,
      title,
      updatedAt: new Date(),
    };

    // Only admins can change these sensitive fields
    if (isAdmin) {
      if (role) updateData.role = role;
      if (status) updateData.status = status;
      if (userType) updateData.userType = userType;
    }

    // Fetch existing profile to check status change and get email
    const [existingProfile] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);

    // 1. Update Profile in database
    await db.update(profiles)
      .set(updateData)
      .where(eq(profiles.id, id));

    // Check for approval (status changed from pending/inactive to active)
    if (isAdmin && status === 'active' && existingProfile?.status !== 'active') {
      try {
        // 1. Queue Email
        const { queueEmail } = await import('@/src/lib/queue/jobs');
        await queueEmail({
          to: existingProfile.email,
          subject: 'Your IconicConnect Account has been Approved!',
          type: 'approval',
          html: `
            <h1>Account Approved!</h1>
            <p>Hello ${existingProfile.fullName || existingProfile.email},</p>
            <p>Great news! Your IconicConnect account has been approved and is now active.</p>
            <p>You can now log in and access all features of the portal.</p>
            <p><strong>Login URL:</strong> http://localhost:3000/auth/sign-in</p>
          `
        });

        // 2. Create In-app Notification
        const { notifications } = await import('@/src/db/schema/notification');
        await db.insert(notifications).values({
          userId: id,
          title: 'Account Approved',
          message: 'Your account has been approved. Welcome to IconicConnect!',
          type: 'approval',
        });
      } catch (queueError) {
        console.error('Failed to process approval notifications:', queueError);
      }
    }

    // 2. Update Auth user if needed (e.g. metadata)
    const authUpdate: AuthMetadataUpdate = {};
    if (updateData.fullName) authUpdate.fullName = updateData.fullName;
    if (updateData.role) authUpdate.role = updateData.role;
    if (updateData.userType) authUpdate.userType = updateData.userType;

    if (Object.keys(authUpdate).length > 0) {
      await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: authUpdate,
      });
    }

    await logActivity({
      actor: currentProfile,
      action: 'member.updated',
      details: {
        memberId: id,
        previous: existingProfile
          ? {
              fullName: existingProfile.fullName,
              role: existingProfile.role,
              status: existingProfile.status,
              phone: existingProfile.phone,
              title: existingProfile.title,
              userType: existingProfile.userType,
            }
          : null,
        changes: {
          fullName: updateData.fullName,
          role: updateData.role,
          status: updateData.status,
          phone: updateData.phone,
          title: updateData.title,
          userType: updateData.userType,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error updating member:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
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
    const [existingProfile] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);

    // 1. Delete from Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    await logActivity({
      actor: actorProfile,
      action: 'member.deleted',
      details: {
        memberId: id,
        email: existingProfile?.email ?? null,
        fullName: existingProfile?.fullName ?? null,
        role: existingProfile?.role ?? null,
        userType: existingProfile?.userType ?? null,
      },
    });

    // 2. Delete from Profile (Cascade should handle relations, but let's be explicit if needed)
    await db.delete(profiles).where(eq(profiles.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting member:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
