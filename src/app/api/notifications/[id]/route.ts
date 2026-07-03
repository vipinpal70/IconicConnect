import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { notifications } from '@/src/db/schema/notification';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and } from 'drizzle-orm';
import { invalidateNotificationCache } from '@/src/lib/redis-cache';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: notificationId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { read, dismissed } = body;

    const updateFields: Partial<typeof notifications.$inferInsert> = {};
    if (typeof read === 'boolean') {
      updateFields.read = read;
    }
    if (typeof dismissed === 'boolean') {
      updateFields.dismissed = dismissed;
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 });
    }

    // Perform the update ensuring the notification belongs to the authenticated user
    const [updated] = await db
      .update(notifications)
      .set(updateFields)
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    await invalidateNotificationCache(user.id)
    return NextResponse.json({ data: updated });
  } catch (error: unknown) {
    console.error('Update notification error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
