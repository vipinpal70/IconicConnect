import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/src/db';
import { chatMessages } from '@/src/db/schema/chat';
import { insertFiles } from '@/src/lib/files-repo';
import { loadChatChanges, loadChatPage, openChat, toChatPayload } from '@/src/lib/chat-messages';
import { profiles } from '@/src/db/schema/profile';
import { cases } from '@/src/db/schema/case';
import { eq } from 'drizzle-orm';
import { createClient } from '@/src/lib/auth/server';
import { canAccessCaseChat, markCaseChatRead } from '@/src/lib/chat';
import { announceChatMessage } from '@/src/lib/queue/chat-jobs';

const querySchema = z.object({
  /** Newest-first page before this message. */
  before: z.uuid().optional(),
  /** Only what changed since this point (the `cursor` of the previous answer). */
  since: z.string().regex(/^\d{1,16}$/).optional(),
});

/**
 * GET: the newest messages, older ones (`?before=`), or only what changed since the last look (`?since=`).
 * Loading never marks anything as read: see ./read.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: caseId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const query = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!query.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    if (!z.uuid().safeParse(caseId).success) return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const chat = await openChat(caseId, user.id);
    if (chat.status === 404) return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    if (chat.status === 403) {
      return NextResponse.json({ error: 'Forbidden: You do not have access to this case chat' }, { status: 403 });
    }
    const { viewer, cursor } = chat;

    if (query.data.since) {
      const changes = await loadChatChanges(caseId, viewer, query.data.since);
      if (changes) return NextResponse.json({ data: changes, cursor, changes: true });
      // Away for so long that a fresh page is smaller than the changes
    }
    const { messages, hasMore } = await loadChatPage(caseId, viewer, query.data.before);
    return NextResponse.json({ data: messages, cursor, hasMore });
  } catch (error: unknown) {
    console.error('Fetch chat error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
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

    // Message and attachment together: nobody can load one without the other
    const { newMessage, attachment } = await db.transaction(async (tx) => {
      const [newMessage] = await tx
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
          }], tx)
        : [];
      return { newMessage, attachment };
    });

    // Everyone on the case: open chats and the bell now; email once the message can no longer be edited or deleted.
    await announceChatMessage(caseRecord, newMessage, profile.fullName);
    // After it, so that the sender's own lists end up without a badge
    await markCaseChatRead(caseId, profile.id, newMessage.id);

    return NextResponse.json({ data: toChatPayload(newMessage, profile.fullName || 'User', attachment ?? null, { id: profile.id, chatLocked: false }, 0) });
  } catch (error: unknown) {
    console.error('Post chat message error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
