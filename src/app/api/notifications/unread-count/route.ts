import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { notifications } from '@/src/db/schema/notification';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and, sql } from 'drizzle-orm';
import { getCachedData, setCachedData } from '@/src/lib/redis-cache';

const UNREAD_TTL = 60 // 1 minute

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cacheKey = `notifications:${user.id}:unread`
    const cached = await getCachedData<{ count: number }>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Fast count query optimized by compound indexes
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.read, false),
          eq(notifications.dismissed, false)
        )
      );

    const payload = { count: countResult?.count || 0 }
    await setCachedData(cacheKey, payload, UNREAD_TTL)
    return NextResponse.json(payload);
  } catch (error: unknown) {
    console.error('Fetch unread count error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
