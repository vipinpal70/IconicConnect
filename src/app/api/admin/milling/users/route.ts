import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { profiles } from '@/src/db/schema/profile';
import { millingCenters } from '@/src/db/schema/milling';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and, desc } from 'drizzle-orm';
import { createMillingUser, MILLING_ROLES } from '@/src/lib/milling/create-milling-user';

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

    const user = await createMillingUser({
      email,
      password,
      fullName,
      role,
      millingCenterId,
      centerName: center.name,
      phone,
      actor: actorProfile,
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('Error creating milling user:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
