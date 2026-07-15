import { and, eq, gte, inArray, ne, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { chatMessages, chatReadStates } from '@/src/db/schema/chat'
import { profiles, type Profile } from '@/src/db/schema/profile'

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
        gte(chatMessages.createdAt, todayStart)
      ))
      .groupBy(chatMessages.caseId),
    db
      .select({
        caseId: chatMessages.caseId,
        maxCreatedAt: sql<Date>`max(${chatMessages.createdAt})`,
      })
      .from(chatMessages)
      .where(and(
        inArray(chatMessages.caseId, caseIds),
        ne(chatMessages.senderId, userId)
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

export async function markCaseChatRead(caseId: string, userId: string) {
  const now = new Date()

  await db
    .insert(chatReadStates)
    .values({
      caseId,
      userId,
      lastReadAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [chatReadStates.caseId, chatReadStates.userId],
      set: {
        lastReadAt: now,
        updatedAt: now,
      },
    })
}
