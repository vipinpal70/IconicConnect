import { eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { chatMessages } from '@/src/db/schema/chat'
import { files } from '@/src/db/schema/files'
import { profiles } from '@/src/db/schema/profile'
import { chatNotificationPayloads } from '@/src/lib/chat'
import { CHAT_EMAIL_DELAY_MS } from '@/src/lib/chat-rules'
import { NotificationService } from '@/src/lib/notifications/notification-service'
import { deleteKeys } from '../r2-objects'
import { chatQueue, connection } from './client'

/**
 * Work that follows a case chat message, off the request path:
 *   - `email`: sent once the message can no longer be edited or deleted, with its final text;
 *   - `attachment-cleanup`: removes the stored file of a deleted message.
 * Jobs carry ids and keys only, never message text.
 */
export type ChatJob =
  | { kind: 'email'; messageId: string }
  | { kind: 'attachment-cleanup'; messageId: string; keys: string[] }

async function enqueue(job: ChatJob, jobId: string, delay: number) {
  // The queue connection retries forever by design; never let a request wait on it.
  if (connection.status !== 'ready') {
    console.error(`[chat-jobs] Redis not ready: skipped ${job.kind} for message ${job.messageId}`)
    return
  }
  try {
    await chatQueue.add(job.kind, job, { jobId, delay })
  } catch (err) {
    console.error(`[chat-jobs] could not queue ${job.kind}:`, (err as Error).message)
  }
}

export const scheduleChatEmail = (messageId: string) =>
  enqueue({ kind: 'email', messageId }, `chat-email-${messageId}`, CHAT_EMAIL_DELAY_MS)

/**
 * Tells everyone else on the case about a new message: in-app now, by email once it can no longer change.
 * Never throws: the message is already saved.
 */
export async function announceChatMessage(
  caseRecord: typeof cases.$inferSelect,
  message: typeof chatMessages.$inferSelect,
  senderName: string | null,
) {
  try {
    await NotificationService.dispatchMany(await chatNotificationPayloads(caseRecord, message, senderName), { email: false })
  } catch (e) {
    console.error('[chat-jobs] could not notify participants:', e)
  }
  await scheduleChatEmail(message.id)
}

export const scheduleAttachmentCleanup = (messageId: string, keys: string[]) =>
  enqueue({ kind: 'attachment-cleanup', messageId, keys }, `chat-file-${messageId}`, 0)

/** Emails everyone else on the case about a message, unless it was deleted meanwhile. */
export async function sendChatEmails(messageId: string): Promise<{ emailed: number; skipped: boolean }> {
  const [row] = await db
    .select({ message: chatMessages, caseRecord: cases, senderName: profiles.fullName })
    .from(chatMessages)
    .innerJoin(cases, eq(cases.id, chatMessages.caseId))
    .innerJoin(profiles, eq(profiles.id, chatMessages.senderId))
    .where(eq(chatMessages.id, messageId))
    .limit(1)
  if (!row || row.message.deletedAt) return { emailed: 0, skipped: true }
  const payloads = await chatNotificationPayloads(row.caseRecord, row.message, row.senderName)
  const results = await NotificationService.dispatchMany(payloads, { inApp: false })
  return { emailed: results.filter((r) => r.channels.includes('email')).length, skipped: false }
}

/** Only the app's per-upload keys: unguessable, so nobody can point a message at someone else's object. */
const UPLOAD_KEY = /\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+$/i
export const isRemovableUploadKey = (key: string) => !/^https?:/i.test(key) && UPLOAD_KEY.test(key)

/** Deletes the objects no other record points at (checked now, not when queued). */
export async function removeUnreferencedUploads(
  keys: string[],
  deps: { deleteKeys: (keys: string[]) => Promise<number> } = { deleteKeys },
): Promise<{ removed: number }> {
  const candidates = keys.filter(isRemovableUploadKey)
  if (candidates.length === 0) return { removed: 0 }
  const used = new Set(
    (await db.select({ key: files.r2Key }).from(files).where(inArray(files.r2Key, candidates))).map((r) => r.key),
  )
  const unused = candidates.filter((k) => !used.has(k))
  if (unused.length === 0) return { removed: 0 }
  const removed = await deps.deleteKeys(unused)
  if (removed < unused.length) throw new Error(`R2 deleted ${removed}/${unused.length} objects; retrying`)
  return { removed }
}

export async function processChatJob(job: ChatJob) {
  return job.kind === 'email' ? sendChatEmails(job.messageId) : removeUnreferencedUploads(job.keys)
}
