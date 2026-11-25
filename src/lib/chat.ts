import { and, eq, gte, inArray, isNull, max, ne, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { chatMessages, chatReadStates } from '@/src/db/schema/chat'
import { profiles, type Profile } from '@/src/db/schema/profile'
import { notifications } from '@/src/db/schema/notification'
import { publishChatRead } from '@/src/lib/live/chat'
import { notificationsChanged } from '@/src/lib/notifications/changed'
import { NotificationType, type NotificationEventPayload } from '@/src/lib/notifications/notification-events'

type CaseAccessRecord = typeof cases.$inferSelect

export type CaseChatMetadata = {
  todayMessagesCount: number
  hasUnreadChat: boolean
}

export function canAccessCaseChat(caseRecord: CaseAccessRecord, profile: Pick<Profile, 'id' | 'role' | 'createdBy'>) {
  if (profile.role === 'admin') return true
  if (profile.role === 'client') return caseRecord.clientId === profile.id
  if (profile.role === 'subuser') {
    const effectiveClientId = profile.createdBy ?? profile.id
    return caseRecord.clientId === effectiveClientId
  }

  return (
    caseRecord.designerId === profile.id ||
    caseRecord.qcId === profile.id ||
    caseRecord.accountManagerId === profile.id
  )
}

export async function resolveCaseChatParticipantIds(caseRecord: CaseAccessRecord) {
  const participantIds = new Set<string>()

  participantIds.add(caseRecord.clientId)
  if (caseRecord.subuserId) participantIds.add(caseRecord.subuserId)
  if (caseRecord.designerId) participantIds.add(caseRecord.designerId)
  if (caseRecord.qcId) participantIds.add(caseRecord.qcId)
  if (caseRecord.accountManagerId) participantIds.add(caseRecord.accountManagerId)

  const admins = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, 'admin'), eq(profiles.status, 'active')))

  admins.forEach((admin) => participantIds.add(admin.id))

  return Array.from(participantIds)
}

/** What a chat notification says. Also used to refresh it when the message is edited. */
export const chatNotificationText = (senderName: string | null, text: string) =>
  `${senderName || 'User'}: ${text || 'Sent an attachment'}`

/** One notification per person on the case except the sender. */
export async function chatNotificationPayloads(
  caseRecord: CaseAccessRecord,
  message: Pick<typeof chatMessages.$inferSelect, 'id' | 'senderId' | 'messageText'>,
  senderName: string | null,
  participantIds?: string[],
): Promise<NotificationEventPayload[]> {
  const targets = (participantIds ?? (await resolveCaseChatParticipantIds(caseRecord))).filter((id) => id !== message.senderId)
  return targets.map((targetUserId) => ({
    type: NotificationType.CHAT_MESSAGE,
    actorUserId: message.senderId,
    targetUserId,
    entityId: message.id,
    entityType: 'chat',
    title: `New Message on Case ${caseRecord.caseNumber || 'Update'}`,
    message: chatNotificationText(senderName, message.messageText),
    link: `/cases/${caseRecord.id}`,
    metadata: { caseId: caseRecord.id, messageId: message.id },
  }))
}

export async function getCasesChatMetadata(caseIds: string[], userId: string) {
  const metadata = new Map<string, CaseChatMetadata>()

  caseIds.forEach((caseId) => {
    metadata.set(caseId, {
      todayMessagesCount: 0,
      hasUnreadChat: false,
    })
  })

  if (caseIds.length === 0) return metadata

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [todayCounts, latestMessages, readStates] = await Promise.all([
    db
      .select({
        caseId: chatMessages.caseId,
        count: sql<number>`count(*)::int`,
      })
      .from(chatMessages)
      .where(and(
        inArray(chatMessages.caseId, caseIds),
        gte(chatMessages.createdAt, todayStart),
        isNull(chatMessages.deletedAt)
      ))
      .groupBy(chatMessages.caseId),
    db
      .select({
        caseId: chatMessages.caseId,
        // max(), not raw sql: raw results are strings, and `string > Date` is always false
        maxCreatedAt: max(chatMessages.createdAt),
      })
      .from(chatMessages)
      .where(and(
        inArray(chatMessages.caseId, caseIds),
        ne(chatMessages.senderId, userId),
        isNull(chatMessages.deletedAt)
      ))
      .groupBy(chatMessages.caseId),
    db
      .select({
        caseId: chatReadStates.caseId,
        lastReadAt: chatReadStates.lastReadAt,
      })
      .from(chatReadStates)
      .where(and(
        eq(chatReadStates.userId, userId),
        inArray(chatReadStates.caseId, caseIds)
      )),
  ])

  const todayCountsMap = new Map(todayCounts.map((c) => [c.caseId, c.count]))
  const maxCreatedAtMap = new Map(latestMessages.map((m) => [m.caseId, m.maxCreatedAt]))
  const readAtByCase = new Map(readStates.map((state) => [state.caseId, state.lastReadAt]))

  caseIds.forEach((caseId) => {
    const current = metadata.get(caseId)
    if (!current) return

    current.todayMessagesCount = todayCountsMap.get(caseId) ?? 0

    const maxCreatedAt = maxCreatedAtMap.get(caseId)
    if (maxCreatedAt) {
      const lastReadAt = readAtByCase.get(caseId)
      const isUnreadForUser = !lastReadAt || maxCreatedAt > lastReadAt
      if (isUnreadForUser) {
        current.hasUnreadChat = true
      }
    }
  })

  return metadata
}

/**
 * The person has seen the chat up to this message. Never moves backwards; writes nothing when already there.
 * When it moved, the badge goes off on their other devices too.
 */
export async function markCaseChatRead(caseId: string, userId: string, messageId: string) {
  const moved = await db.execute(sql`
    insert into chat_read_states (case_id, user_id, last_read_at)
    select m.case_id, ${userId}::uuid, m.created_at from chat_messages m where m.id = ${messageId}::uuid and m.case_id = ${caseId}::uuid
    on conflict (case_id, user_id) do update set last_read_at = excluded.last_read_at
    where chat_read_states.last_read_at < excluded.last_read_at
    returning 1`)
  if ((moved as unknown as unknown[]).length > 0) await publishChatRead(userId, caseId)
}

/** Marks this chat's notifications read, up to a message. Returns how many changed. */
export async function markChatNotificationsRead(caseId: string, userId: string, messageId: string): Promise<number> {
  const changed = await db
    .update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.read, false),
      eq(notifications.type, NotificationType.CHAT_MESSAGE),
      eq(notifications.link, `/cases/${caseId}`),
      // A message that arrived after the one seen keeps its notification
      sql`(${notifications.metadata}->>'messageId' is null or exists (
        select 1 from chat_messages n, chat_messages seen
        where n.id::text = ${notifications.metadata}->>'messageId' and n.case_id = ${caseId}::uuid
          and seen.id = ${messageId}::uuid and seen.case_id = ${caseId}::uuid and n.created_at <= seen.created_at))`,
    ))
    .returning({ id: notifications.id })
  if (changed.length > 0) await notificationsChanged([userId])
  return changed.length
}
