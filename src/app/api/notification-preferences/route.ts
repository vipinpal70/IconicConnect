import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/auth/server';
import { NotificationService } from '@/src/lib/notifications/notification-service';
import { PREFERENCE_KEYS, setPreference } from '@/src/lib/notifications/preferences';

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

    if (!PREFERENCE_KEYS.includes(key)) {
      return NextResponse.json({ error: `Invalid preference key: ${key}` }, { status: 400 });
    }

    const updated = await setPreference(user.id, key, value);
    return NextResponse.json({ data: updated });
  } catch (error: unknown) {
    console.error('Update notification preference error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
