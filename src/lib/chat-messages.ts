import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { chatMessages } from '@/src/db/schema/chat'
import { files } from '@/src/db/schema/files'
import { profiles } from '@/src/db/schema/profile'
import { canAccessCaseChat } from '@/src/lib/chat'
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
    id: m.id,
    caseId: m.caseId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    messageText: m.messageText,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    senderName,
    mine: m.senderId === viewer.id,
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

export type ChatPayload = ReturnType<typeof toChatPayload>

/**
 * A little overlap between two looks: a message's time is set just before its transaction commits, so one
 * committed a moment late could otherwise fall between them. The browser merges by id, so repeats are harmless.
 */
const CURSOR_OVERLAP_SECONDS = 10
export const CHAT_PAGE_SIZE = 50
const MAX_CHANGES = 200

/** Who is asking, about which case, and the point in time to ask from next: one query for all of it. */
export async function openChat(caseId: string, userId: string) {
  const [row] = await db
    .select({
      caseRecord: cases,
      profile: { id: profiles.id, role: profiles.role, createdBy: profiles.createdBy },
      // Taken before the messages are read, so nothing committed meanwhile is skipped
      cursor: sql<string>`(extract(epoch from clock_timestamp() - make_interval(secs => ${CURSOR_OVERLAP_SECONDS}::int)) * 1000)::bigint::text`,
    })
    .from(cases)
    .innerJoin(profiles, eq(profiles.id, userId))
    .where(eq(cases.id, caseId))
    .limit(1)
  if (!row) return { status: 404 as const }
  if (!canAccessCaseChat(row.caseRecord, row.profile)) return { status: 403 as const }
  return {
    status: 200 as const,
    cursor: row.cursor,
    viewer: { id: userId, chatLocked: row.caseRecord.status === 'client_reject' } satisfies ChatViewer,
  }
}

async function selectMessages(where: SQL | undefined, limit: number, viewer: ChatViewer): Promise<ChatPayload[]> {
  const rows = await db
    .select({
      m: chatMessages,
      senderName: profiles.fullName,
      ageMs: sql<number>`extract(epoch from clock_timestamp() - ${chatMessages.createdAt}) * 1000`.mapWith(Number),
    })
    .from(chatMessages)
    .leftJoin(profiles, eq(profiles.id, chatMessages.senderId))
    .where(where)
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit)
  if (!rows.length) return []
  const att = await db.select().from(files)
    .where(inArray(files.messageId, rows.map((r) => r.m.id)))
    .orderBy(asc(files.createdAt))
  const byMsg = new Map<string, LegacyFile>()
  for (const a of att) if (a.messageId && !byMsg.has(a.messageId)) byMsg.set(a.messageId, toLegacy(a))
  return rows.map((r) => toChatPayload(r.m, r.senderName || 'User', byMsg.get(r.m.id) ?? null, viewer, r.ageMs))
}

/** The newest page, or the page before a message. Newest first. */
export async function loadChatPage(caseId: string, viewer: ChatViewer, before?: string) {
  const older = before
    ? sql`(${chatMessages.createdAt}, ${chatMessages.id}) < (select b.created_at, b.id from chat_messages b where b.id = ${before}::uuid and b.case_id = ${caseId}::uuid)`
    : undefined
  const rows = await selectMessages(and(eq(chatMessages.caseId, caseId), older), CHAT_PAGE_SIZE + 1, viewer)
  return { messages: rows.slice(0, CHAT_PAGE_SIZE), hasMore: rows.length > CHAT_PAGE_SIZE }
}

/** Messages sent, edited or deleted since `cursor`; null when there are too many to send as changes. */
export async function loadChatChanges(caseId: string, viewer: ChatViewer, cursor: string): Promise<ChatPayload[] | null> {
  const rows = await selectMessages(
    and(eq(chatMessages.caseId, caseId), sql`${chatMessages.changedAt} > to_timestamp(${cursor}::bigint / 1000.0)`),
    MAX_CHANGES + 1,
    viewer,
  )
  return rows.length > MAX_CHANGES ? null : rows
}
