import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { notifications } from '@/src/db/schema/notification';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    return NextResponse.json({ count: countResult?.count || 0 });
  } catch (error: unknown) {
    console.error('Fetch unread count error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
