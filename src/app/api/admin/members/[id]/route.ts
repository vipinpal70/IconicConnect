import { logAuthEvent } from '@/src/lib/auth/audit';
import { NextRequest, NextResponse } from 'next/server';
import { getEmail } from '@/src/lib/auth/auth-service'
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { deleteUser } from '@/src/lib/auth/auth-service';
import { destroyAllSessions } from '@/src/lib/auth/session';
import { createClient } from '@/src/lib/auth/server';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/src/lib/activity-log';
import { parseStoredPhone, validateNationalPhone } from '@/src/lib/phone';
import { deleteCachedData } from '@/src/lib/redis-cache';

type MemberUpdateData = {
  fullName?: string
  role?: 'client' | 'subuser' | 'admin' | 'qc' | 'account_manager' | 'designer'
  status?: 'pending' | 'active' | 'inactive'
  phone?: string
  title?: string
  userType?: 'lab_portal' | 'admin_portal'
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


  if (!isAdmin && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { fullName, role, status, phone, title, userType } = body;
    const parsedPhone = parseStoredPhone(phone)
    const phoneError = validateNationalPhone(parsedPhone.countryCode, parsedPhone.nationalNumber)

    if (phoneError) {
      return NextResponse.json({ error: phoneError }, { status: 400 })
    }

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
        const { NotificationService } = await import('@/src/lib/notifications/notification-service');
        const { NotificationType } = await import('@/src/lib/notifications/notification-events');
        await NotificationService.dispatch({
          type: NotificationType.WELCOME,
          actorUserId: user.id,
          targetUserId: id,
          title: 'Account Approved',
          message: `Hello ${existingProfile.fullName || (await getEmail(existingProfile.id))}, your IconicConnect account has been approved and is now active.`,
          link: '/dashboard',
          metadata: { role: existingProfile.role },
        });
      } catch (queueError) {
        console.error('Failed to process approval notifications:', queueError);
      }
    }

    // Role / status / type live in the Redis session — revoke so the change takes effect immediately
    // (a suspended or demoted user must not keep working until their 7 h session ends).
    if (updateData.role || updateData.userType || updateData.status) {
      await destroyAllSessions(id).catch((e) => console.error('[members PATCH] session revoke failed', e));

      // Audit only what actually changed (from -> to); a no-op PATCH is not a security event.
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      if (updateData.role && updateData.role !== existingProfile?.role) changes.role = { from: existingProfile?.role ?? null, to: updateData.role };
      if (updateData.status && updateData.status !== existingProfile?.status) changes.status = { from: existingProfile?.status ?? null, to: updateData.status };
      if (updateData.userType && updateData.userType !== existingProfile?.userType) changes.userType = { from: existingProfile?.userType ?? null, to: updateData.userType };
      if (Object.keys(changes).length > 0) {
        logAuthEvent({ event: 'role_changed', userId: id, actorId: user.id, email: await getEmail(id), headers: req.headers, details: { changes, sessionsRevoked: true } });
      }
    }

    await Promise.all([
      deleteCachedData(`profile:${id}`),
      deleteCachedData(`client:${id}`),
      deleteCachedData('clients:list:v2'),
    ])

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

  if (user.id === id) {
    return NextResponse.json({ error: 'Admins cannot delete their own account' }, { status: 403 });
  }

  try {
    const [existingProfile] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);

    // Capture identity BEFORE deleting: afterwards the email is gone from `users`.
    const deletedEmail = await getEmail(id);

    // 1. Delete the credential row; the profile row goes with it (ON DELETE CASCADE) and sessions are revoked.
    await deleteUser(id);
    // userId is NULL on purpose: the account no longer exists, so a FK to it would be rejected. The id and email are kept in the record.
    logAuthEvent({ event: 'account_deleted', userId: null, actorId: user.id, email: deletedEmail, headers: req.headers, details: { deletedUserId: id, role: existingProfile?.role ?? null } });

    await logActivity({
      actor: actorProfile,
      action: 'member.deleted',
      details: {
        memberId: id,
        email: deletedEmail || null,
        fullName: existingProfile?.fullName ?? null,
        role: existingProfile?.role ?? null,
        userType: existingProfile?.userType ?? null,
      },
    });

    await Promise.all([
      deleteCachedData(`profile:${id}`),
      deleteCachedData(`client:${id}`),
      deleteCachedData('clients:list:v2'),
    ])

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting member:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
