import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { isValidRoleForType } from '@/src/lib/auth/role';

/**
 * GET /api/profile/[id] — a user's own profile, or any profile for admin-portal staff.
 * Reads through Drizzle after the authorization check (the PostgREST path is locked down in
 * migration 0056), and never returns the legacy `password` column.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [requester] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1);

    const isStaff = !!requester && isValidRoleForType('admin_portal', requester.role);
    if (user.id !== id && !isStaff) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [profile] = await db
      .select({
        id: profiles.id,
        userType: profiles.userType,
        role: profiles.role,
        status: profiles.status,
        plan: profiles.plan,
        fullName: profiles.fullName,
        title: profiles.title,
        email: profiles.email,
        phone: profiles.phone,
        labName: profiles.labName,
        postalCode: profiles.postalCode,
        city: profiles.city,
        state: profiles.state,
        country: profiles.country,
        createdBy: profiles.createdBy,
        createdAt: profiles.createdAt,
        updatedAt: profiles.updatedAt,
        onBoardedAt: profiles.onBoardedAt,
      })
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ ...profile, name: profile.fullName });
  } catch (error) {
    console.error('[api/profile/[id]] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
