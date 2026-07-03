import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { notifications } from '@/src/db/schema/notification';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and } from 'drizzle-orm';
import { invalidateNotificationCache } from '@/src/lib/redis-cache';

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Set read = true for all active/unread notifications of this user
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.read, false),
          eq(notifications.dismissed, false)
        )
      );

    await invalidateNotificationCache(user.id)
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Mark all notifications read error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
