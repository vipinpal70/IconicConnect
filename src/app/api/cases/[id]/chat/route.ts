import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { chatMessages } from '@/src/db/schema/chat';
import { profiles } from '@/src/db/schema/profile';
import { cases } from '@/src/db/schema/case';
import { eq, desc } from 'drizzle-orm';
import { createClient } from '@/src/lib/supabase/server';
import { NotificationService } from '@/src/lib/notifications/notification-service';
import { NotificationType } from '@/src/lib/notifications/notification-events';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: caseId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Verify case exists
    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // Load messages sorted by createdAt descending (latest first)
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.caseId, caseId))
      .orderBy(desc(chatMessages.createdAt));

    return NextResponse.json({ data: messages });
  } catch (error: unknown) {
    console.error('Fetch chat error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: caseId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Verify case exists
    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const body = await req.json();
    const { messageText, fileUrl, fileName, fileType, fileSize } = body;

    // 1. Text or file must be present
    if (!messageText?.trim() && !fileUrl) {
      return NextResponse.json({ error: 'Message text or file attachment is required' }, { status: 400 });
    }

    // 2. Role restriction check: ONLY clients and subusers can upload files!
    if (fileUrl) {
      const isClientRole = profile.role === 'client' || profile.role === 'subuser';
      if (!isClientRole) {
        return NextResponse.json({ error: 'Forbidden: Admins, designers, and QC leads cannot send media files.' }, { status: 403 });
      }

      // Check max file size limit (500MB)
      if (fileSize && Number(fileSize) > 500 * 1024 * 1024) {
        return NextResponse.json({ error: 'Forbidden: File size exceeds the 500MB limit for chat messages' }, { status: 400 });
      }
    }

    // Save message to database
    const [newMessage] = await db
      .insert(chatMessages)
      .values({
        caseId,
        senderId: profile.id,
        senderRole: profile.role,
        senderName: profile.fullName || 'User',
        messageText: messageText?.trim() || '',
        fileUrl: fileUrl || null,
        fileName: fileName || null,
        fileType: fileType || null,
        fileSize: fileSize ? String(fileSize) : null,
      })
      .returning();

    // Trigger Notification for Chat Counterpart
    try {
      let targetUserId: string | null = null;
      if (profile.role === 'client' || profile.role === 'subuser') {
        targetUserId = caseRecord.designerId || caseRecord.accountManagerId;
      } else {
        targetUserId = caseRecord.subuserId || caseRecord.clientId;
      }

      if (targetUserId) {
        NotificationService.dispatch({
          type: NotificationType.CHAT_MESSAGE,
          actorUserId: profile.id,
          targetUserId,
          entityId: newMessage.id,
          entityType: 'chat',
          title: `New Message on Case ${caseRecord.caseNumber || 'Update'}`,
          message: `${profile.fullName || 'User'}: ${messageText?.trim() || 'Sent an attachment'}`,
          link: `/cases/${caseId}`,
        }).catch((err) => console.error('[ChatNotificationTrigger] Failed to dispatch chat notification:', err));
      }
    } catch (e) {
      console.error('[ChatNotificationTrigger] Error resolving target participant:', e);
    }

    return NextResponse.json({ data: newMessage });
  } catch (error: unknown) {
    console.error('Post chat message error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
