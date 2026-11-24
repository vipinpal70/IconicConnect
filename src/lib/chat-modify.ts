import { and, eq, gte, sql, type SQL } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { chatMessages } from '@/src/db/schema/chat'
import { files } from '@/src/db/schema/files'
import { notifications } from '@/src/db/schema/notification'
import type { Profile } from '@/src/db/schema/profile'
import { logActivity } from '@/src/lib/activity-log'
import { canAccessCaseChat, chatNotificationText } from '@/src/lib/chat'
import { CASE_ACTION_PREFIXES, CHAT_MODIFY_GRACE_MS, CHAT_MODIFY_WINDOW_MS, isCaseActionLine } from '@/src/lib/chat-rules'
import { NotificationType } from '@/src/lib/notifications/notification-events'
import { NotificationService } from '@/src/lib/notifications/notification-service'
import { isRemovableUploadKey, scheduleAttachmentCleanup } from '@/src/lib/queue/chat-jobs'

/**
 * Editing and deleting case chat messages. Every rule (sender, time window, not deleted, not a case-action
 * line, chat not locked) is part of the UPDATE's WHERE clause, so nothing can change between the check and
 * the write. Only when no row matched do we look up why, to give a useful answer.
 */

export class ChatModifyError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ALLOWED_AGE_SECONDS = (CHAT_MODIFY_WINDOW_MS + CHAT_MODIFY_GRACE_MS) / 1000

// clock_timestamp(), not now(): now() is frozen at the start of the transaction
const withinWindow = sql<boolean>`${chatMessages.createdAt} > clock_timestamp() - make_interval(secs => ${ALLOWED_AGE_SECONDS}::int)`
const hasAttachment = sql<boolean>`exists (select 1 from files f where f.message_id = chat_messages.id)`
const chatOpen = sql<boolean>`exists (select 1 from cases c where c.id = chat_messages.case_id and c.status <> 'client_reject')`

function modifiable(caseId: string, messageId: string, senderId: string): SQL {
  return and(
    eq(chatMessages.id, messageId),
    eq(chatMessages.caseId, caseId),
    eq(chatMessages.senderId, senderId),
    sql`${chatMessages.deletedAt} is null`,
    withinWindow,
    chatOpen,
    ...CASE_ACTION_PREFIXES.map((p) => sql`not starts_with(${chatMessages.messageText}, ${p}::text)`),
  )!
}

async function assertChatAccess(caseId: string, profile: Profile) {
  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1)
  if (!caseRecord) throw new ChatModifyError(404, 'not_found', 'Case not found')
  if (!canAccessCaseChat(caseRecord, profile)) {
    throw new ChatModifyError(403, 'forbidden', 'You do not have access to this case chat')
  }
}

/** Why the UPDATE matched nothing. */
async function explain(tx: Tx, caseId: string, messageId: string, senderId: string): Promise<ChatModifyError> {
  const [row] = await tx
    .select({
      senderId: chatMessages.senderId,
      deletedAt: chatMessages.deletedAt,
      text: chatMessages.messageText,
      inWindow: withinWindow,
      open: chatOpen,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.caseId, caseId)))
    .limit(1)
  if (!row) return new ChatModifyError(404, 'not_found', 'Message not found')
  if (row.senderId !== senderId) return new ChatModifyError(403, 'not_sender', 'You can only change your own messages')
  if (row.deletedAt) return new ChatModifyError(409, 'deleted', 'This message was already deleted')
  if (!row.open) return new ChatModifyError(409, 'chat_locked', 'Chat is disabled because this case has been rejected')
  if (isCaseActionLine(row.text)) {
    return new ChatModifyError(409, 'case_action', 'This message records a case action and cannot be changed')
  }
  if (!row.inWindow) {
    return new ChatModifyError(409, 'window_closed', 'Messages can only be changed within 2 minutes of sending')
  }
  return new ChatModifyError(409, 'attachment', 'A message with an attachment cannot be edited, only deleted')
}

/** In-app notifications created for this message (they quote its text). */
const notificationsOf = (messageId: string, createdAt: Date) =>
  and(
    eq(notifications.type, NotificationType.CHAT_MESSAGE),
    gte(notifications.createdAt, createdAt),
    sql`${notifications.metadata}->>'messageId' = ${messageId}`,
  )

// The content is never logged. The case id goes in the details: rows with a case_id are the timeline labs see.
function audit(profile: Profile, action: 'chat.message_edited' | 'chat.message_deleted', caseId: string, messageId: string) {
  return logActivity({ actor: profile, action, details: { caseId, messageId } }).catch((err) =>
    console.error(`[${action}] logActivity`, err),
  )
}

export async function editChatMessage(profile: Profile, caseId: string, messageId: string, text: string) {
  await assertChatAccess(caseId, profile)
  const { message, notified } = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(chatMessages)
      .set({ messageText: text, editedAt: sql`clock_timestamp()` })
      .where(and(modifiable(caseId, messageId, profile.id), sql`not ${hasAttachment}`))
      .returning()
    if (!updated) throw await explain(tx, caseId, messageId, profile.id)
    const changed = await tx
      .update(notifications)
      .set({ message: chatNotificationText(profile.fullName, text) })
      .where(notificationsOf(messageId, updated.createdAt))
      .returning({ userId: notifications.userId })
    return { message: updated, notified: changed.map((n) => n.userId) }
  })
  await NotificationService.invalidateUnreadCaches(notified)
  await audit(profile, 'chat.message_edited', caseId, messageId)
  return message
}

export async function deleteChatMessage(profile: Profile, caseId: string, messageId: string) {
  await assertChatAccess(caseId, profile)
  const { keys, notified } = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .update(chatMessages)
      .set({ messageText: '', deletedAt: sql`clock_timestamp()` })
      .where(modifiable(caseId, messageId, profile.id))
      .returning({ createdAt: chatMessages.createdAt })
    if (!deleted) throw await explain(tx, caseId, messageId, profile.id)
    const removedFiles = await tx.delete(files).where(eq(files.messageId, messageId)).returning({ key: files.r2Key })
    const removed = await tx
      .delete(notifications)
      .where(notificationsOf(messageId, deleted.createdAt))
      .returning({ userId: notifications.userId })
    return {
      keys: removedFiles.map((f) => f.key).filter(isRemovableUploadKey),
      notified: removed.map((n) => n.userId),
    }
  })
  // After commit: the job re-checks that nothing else uses the file. Other keys are left to the orphan sweep.
  if (keys.length > 0) await scheduleAttachmentCleanup(messageId, keys)
  await NotificationService.invalidateUnreadCaches(notified)
  await audit(profile, 'chat.message_deleted', caseId, messageId)
}
