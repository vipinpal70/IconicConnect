import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { notificationPreferences } from '@/src/db/schema/notification';
import { createClient } from '@/src/lib/supabase/server';
import { NotificationService } from '@/src/lib/notifications/notification-service';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetches or seeds default preferences for the user on-demand
    const prefs = await NotificationService.getPreferences(user.id);
    return NextResponse.json({ data: prefs });
  } catch (error: unknown) {
    console.error('Fetch notification preferences error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { key, value } = body;

    if (!key || typeof value !== 'boolean') {
      return NextResponse.json({ error: 'Key (string) and Value (boolean) are required' }, { status: 400 });
    }

    // Ensure the row exists
    await NotificationService.getPreferences(user.id);

    // Build the updates object dynamically checking against allowed column names
    const allowedKeys = [
      'emailEnabled',
      'inAppEnabled',
      'caseAssignedEmail',
      'caseAssignedInApp',
      'caseFeedbackEmail',
      'caseFeedbackInApp',
      'caseApprovedEmail',
      'caseApprovedInApp',
      'caseRejectedEmail',
      'caseRejectedInApp',
      'caseHoldEmail',
      'caseHoldInApp',
      'caseCancelEmail',
      'caseCancelInApp',
      'caseReminderEmail',
      'caseReminderInApp',
      'chatMessageEmail',
      'chatMessageInApp'
    ];

    if (!allowedKeys.includes(key)) {
      return NextResponse.json({ error: `Invalid preference key: ${key}` }, { status: 400 });
    }

    const updateFields = { [key]: value };

    const [updated] = await db
      .update(notificationPreferences)
      .set(updateFields)
      .where(eq(notificationPreferences.userId, user.id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Preference not found' }, { status: 404 });
    }

    return NextResponse.json({ data: updated });
  } catch (error: unknown) {
    console.error('Update notification preference error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
