import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { chatMessages } from '@/src/db/schema/chat'
import { files } from '@/src/db/schema/files'
import { profiles } from '@/src/db/schema/profile'
import { chatModifyState } from '@/src/lib/chat-rules'
import { toLegacy, type LegacyFile } from '@/src/lib/files-repo'

type Msg = typeof chatMessages.$inferSelect

export interface ChatViewer {
  id: string
  /** The case was rejected by the lab, so nothing in the chat can change. */
  chatLocked: boolean
}

/** Message in the shape the chat UI consumes (name + attachment fields flattened in). */
export function toChatPayload(m: Msg, senderName: string, f: LegacyFile | null, viewer: ChatViewer, ageMs: number) {
  const deleted = m.deletedAt !== null
  return {
    ...m,
    senderName,
    deleted,
    fileUrl: deleted ? null : f?.fileUrl ?? null,
    fileName: deleted ? null : f?.fileName ?? null,
    fileType: deleted ? null : f?.fileType ?? null,
    fileSize: !deleted && f?.fileSize != null ? String(f.fileSize) : null,
    // Remaining time rather than a timestamp: the browser counts down from when it received this, so a
    // wrong clock on someone's computer can't open or close the window early
    ...chatModifyState({
      isSender: m.senderId === viewer.id,
      deleted,
      text: m.messageText,
      hasAttachment: f !== null,
      chatLocked: viewer.chatLocked,
      ageMs,
    }),
  }
}

/** Thread, newest first: messages ⨝ sender name (idx_chat_case_time) + one attachment query for the whole page. */
export async function loadChatMessages(caseId: string, viewer: ChatViewer) {
  const rows = await db
    .select({
      m: chatMessages,
      senderName: profiles.fullName,
      ageMs: sql<number>`extract(epoch from clock_timestamp() - ${chatMessages.createdAt}) * 1000`.mapWith(Number),
    })
    .from(chatMessages)
    .leftJoin(profiles, eq(profiles.id, chatMessages.senderId))
    .where(eq(chatMessages.caseId, caseId))
    .orderBy(desc(chatMessages.createdAt))
  if (!rows.length) return []
  const att = await db.select().from(files)
    .where(inArray(files.messageId, rows.map((r) => r.m.id)))
    .orderBy(asc(files.createdAt))
  const byMsg = new Map<string, LegacyFile>()
  for (const a of att) if (a.messageId && !byMsg.has(a.messageId)) byMsg.set(a.messageId, toLegacy(a))
  return rows.map((r) => toChatPayload(r.m, r.senderName || 'User', byMsg.get(r.m.id) ?? null, viewer, r.ageMs))
}
