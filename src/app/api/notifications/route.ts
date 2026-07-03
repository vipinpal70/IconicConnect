import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { notifications } from '@/src/db/schema/notification';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and, desc } from 'drizzle-orm';
import { getCachedData, setCachedData } from '@/src/lib/redis-cache';

const NOTIF_LIST_TTL = 60 // 1 minute

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit') || '20'), 100);
    const offset = Math.max(Number(searchParams.get('offset') || '0'), 0);

    const cacheKey = `notifications:${user.id}:list:${limit}:${offset}`
    const cached = await getCachedData<{ data: unknown[] }>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Retrieve active (non-dismissed) notifications sorted by latest first
    const list = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.dismissed, false)))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    const payload = { data: list }
    await setCachedData(cacheKey, payload, NOTIF_LIST_TTL)
    return NextResponse.json(payload);
  } catch (error: unknown) {
    console.error('Fetch notifications error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
