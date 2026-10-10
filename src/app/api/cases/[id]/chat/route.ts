import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { chatMessages } from '@/src/db/schema/chat';
import { insertFiles } from '@/src/lib/files-repo';
import { loadChatMessages, toChatPayload } from '@/src/lib/chat-messages';
import { profiles } from '@/src/db/schema/profile';
import { cases } from '@/src/db/schema/case';
import { and, desc, eq } from 'drizzle-orm';
import { createClient } from '@/src/lib/auth/server';
import { NotificationService } from '@/src/lib/notifications/notification-service';
import { NotificationType } from '@/src/lib/notifications/notification-events';
import { notifications } from '@/src/db/schema/notification';
import { canAccessCaseChat, markCaseChatRead, resolveCaseChatParticipantIds } from '@/src/lib/chat';

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

    if (!canAccessCaseChat(caseRecord, profile)) {
      return NextResponse.json({ error: 'Forbidden: You do not have access to this case chat' }, { status: 403 });
    }

    // Load messages sorted by createdAt descending (latest first)
    const messages = await loadChatMessages(caseId);

    await markCaseChatRead(caseId, profile.id);
    await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(
        eq(notifications.userId, profile.id),
        eq(notifications.type, NotificationType.CHAT_MESSAGE),
        eq(notifications.link, `/cases/${caseId}`),
        eq(notifications.read, false),
      ));

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

    if (!canAccessCaseChat(caseRecord, profile)) {
      return NextResponse.json({ error: 'Forbidden: You do not have access to this case chat' }, { status: 403 });
    }

    if (caseRecord.status === 'client_reject') {
      return NextResponse.json({ error: 'Forbidden: Chat is disabled because this case has been rejected' }, { status: 400 });
    }

    const body = await req.json();
    const { messageText, fileUrl, fileName, fileType, fileSize } = body;

    // 1. Text or file must be present
    if (!messageText?.trim() && !fileUrl) {
      return NextResponse.json({ error: 'Message text or file attachment is required' }, { status: 400 });
    }

    // 2. Anyone with chat access (checked above via canAccessCaseChat) may attach a file.
    if (fileUrl) {
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
        messageText: messageText?.trim() || '',
      })
      .returning();

    // Attachment = a `files` row of kind 'chat' owned by the message (not the case).
    const [attachment] = fileUrl
      ? await insertFiles([{
          clientId: caseRecord.clientId, caseId: null, messageId: newMessage.id, kind: 'chat', uploadedBy: profile.id,
          fileName: fileName || 'attachment', fileUrl, fileType: fileType || null, fileSize: fileSize ? Number(fileSize) : null,
        }])
      : [];

    await markCaseChatRead(caseId, profile.id);

    // Trigger notifications for all case chat participants except the sender.
    try {
      const targetUserIds = (await resolveCaseChatParticipantIds(caseRecord))
        .filter((targetUserId) => targetUserId !== profile.id);

      await Promise.allSettled(targetUserIds.map((targetUserId) =>
        NotificationService.dispatch({
          type: NotificationType.CHAT_MESSAGE,
          actorUserId: profile.id,
          targetUserId,
          entityId: newMessage.id,
          entityType: 'chat',
          title: `New Message on Case ${caseRecord.caseNumber || 'Update'}`,
          message: `${profile.fullName || 'User'}: ${messageText?.trim() || 'Sent an attachment'}`,
          link: `/cases/${caseId}`,
          metadata: { caseId, messageId: newMessage.id },
        })
      ));
    } catch (e) {
      console.error('[ChatNotificationTrigger] Error resolving target participants:', e);
    }

    return NextResponse.json({ data: toChatPayload(newMessage, profile.fullName || 'User', attachment ?? null) });
  } catch (error: unknown) {
    console.error('Post chat message error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
