import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { notifications } from '@/src/db/schema/notification';
import { createClient } from '@/src/lib/supabase/server';
import { and, eq, desc, ne } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter'); // 'unread', 'read', 'all'
    const type = searchParams.get('type');     // 'case', 'support', 'approval', etc.

    let conditions = [
      eq(notifications.userId, user.id),
      eq(notifications.isDismissed, false) // Default: hide dismissed
    ];

    if (filter === 'unread') {
      conditions.push(eq(notifications.isRead, false));
    } else if (filter === 'read') {
      conditions.push(eq(notifications.isRead, true));
    }

    if (type && type !== 'all') {
      conditions.push(eq(notifications.type, type));
    }

    const userNotifications = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    return NextResponse.json(userNotifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, action } = await req.json(); // action: 'read', 'dismiss', 'read_all'

    if (action === 'read_all') {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, user.id));
    } else if (id) {
      if (action === 'dismiss') {
        await db
          .update(notifications)
          .set({ isDismissed: true })
          .where(eq(notifications.id, id));
      } else {
        // default: mark as read
        await db
          .update(notifications)
          .set({ isRead: true })
          .where(eq(notifications.id, id));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating notifications:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
