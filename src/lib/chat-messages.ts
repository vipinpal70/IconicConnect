import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { chatMessages } from '@/src/db/schema/chat'
import { files } from '@/src/db/schema/files'
import { profiles } from '@/src/db/schema/profile'
import { toLegacy, type LegacyFile } from '@/src/lib/files-repo'

type Msg = typeof chatMessages.$inferSelect

/** Message in the shape the chat UI already consumes (name + attachment fields flattened in). */
export function toChatPayload(m: Msg, senderName: string, f: LegacyFile | null) {
  return {
    ...m,
    senderName,
    fileUrl: f?.fileUrl ?? null,
    fileName: f?.fileName ?? null,
    fileType: f?.fileType ?? null,
    fileSize: f?.fileSize != null ? String(f.fileSize) : null,
  }
}

/** Thread, newest first: messages ⨝ sender name (idx_chat_case_time) + one attachment query for the whole page. */
export async function loadChatMessages(caseId: string) {
  const rows = await db
    .select({ m: chatMessages, senderName: profiles.fullName })
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
  return rows.map((r) => toChatPayload(r.m, r.senderName || 'User', byMsg.get(r.m.id) ?? null))
}
