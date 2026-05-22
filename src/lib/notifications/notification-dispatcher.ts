import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { NotificationType } from './notification-events'
import { NotificationService } from './notification-service'

type PortalRole = 'admin' | 'qc' | 'account_manager' | 'client' | 'subuser'

type DispatchPayload = {
  actorUserId: string
  title: string
  message: string
  link?: string
  metadata?: Record<string, unknown>
}

async function resolveActiveProfileIds(roles: PortalRole[]) {
  if (!roles.length) return []

  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.status, 'active'), inArray(profiles.role, roles)))

  return rows.map((row) => row.id)
}

async function dispatchToUserIds(
  targetUserIds: string[],
  buildPayload: (targetUserId: string) => DispatchPayload & { type: NotificationType | string }
) {
  const results = await Promise.allSettled(
    targetUserIds.map(async (targetUserId) => {
      const payload = buildPayload(targetUserId)
      await NotificationService.dispatch({
        ...payload,
        targetUserId,
      })
    })
  )

  return {
    attempted: targetUserIds.length,
    succeeded: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  }
}

export async function notifySupportTicketCreated(input: {
  actorUserId: string
  ticketId: string
  ticketNumber: string
  subject: string
  category: string
  priority: string
  clientName: string
}) {
  const adminIds = await resolveActiveProfileIds(['admin', 'qc', 'account_manager'])

  return dispatchToUserIds(adminIds, (targetUserId) => ({
    type: NotificationType.SUPPORT_TICKET_CREATED,
    actorUserId: input.actorUserId,
    title: `New support ticket ${input.ticketNumber}`,
    message: `${input.clientName} submitted "${input.subject}" (${input.category}, ${input.priority}).`,
    link: '/admin/support',
    metadata: {
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      targetUserId,
    },
  }))
}

export async function notifySupportTicketUpdated(input: {
  actorUserId: string
  clientId: string
  ticketId: string
  ticketNumber: string
  subject: string
  event: 'updated' | 'resolved' | 'closed'
  ticketStatus: string
  adminNotes?: string | null
}) {
  let type = NotificationType.SUPPORT_TICKET_UPDATED
  let title = `Support ticket ${input.ticketNumber} updated`
  let body = `Your support ticket "${input.subject}" has been updated.`

  if (input.event === 'resolved') {
    type = NotificationType.SUPPORT_TICKET_RESOLVED
    title = `Support ticket ${input.ticketNumber} resolved`
    body = `Your support ticket "${input.subject}" has been resolved.`
  } else if (input.event === 'closed') {
    type = NotificationType.SUPPORT_TICKET_CLOSED
    title = `Support ticket ${input.ticketNumber} closed`
    body = `Your support ticket "${input.subject}" has been closed.`
  }

  const noteSummary = input.adminNotes?.trim()
    ? ` Admin note: ${input.adminNotes.trim()}`
    : ''

  return NotificationService.dispatch({
    type,
    actorUserId: input.actorUserId,
    targetUserId: input.clientId,
    title,
    message: `${body}${noteSummary}`,
    link: '/client/support',
    metadata: {
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      subject: input.subject,
      status: input.ticketStatus,
      event: input.event,
      adminNotes: input.adminNotes ?? null,
    },
  })
}

export async function notifyCallbackRequestCreated(input: {
  actorUserId: string
  requestId: string
  clientId: string
  clientName: string
  labName: string
  requesterName: string
}) {
  const adminIds = await resolveActiveProfileIds(['admin', 'qc', 'account_manager'])

  return dispatchToUserIds(adminIds, (targetUserId) => ({
    type: NotificationType.SUPPORT_CALLBACK_REQUESTED,
    actorUserId: input.actorUserId,
    title: `Callback requested by ${input.clientName}`,
    message: `${input.labName} requested a callback. Requested by ${input.requesterName}.`,
    link: '/admin/support/callback-requests',
    metadata: {
      requestId: input.requestId,
      clientId: input.clientId,
      clientName: input.clientName,
      labName: input.labName,
      requesterName: input.requesterName,
      targetUserId,
    },
  }))
}

export async function notifyOfferCreated(input: {
  actorUserId: string
  offerId: string
  title: string
  brand: string
  discount: string
  category: string
}) {
  const clientIds = await resolveActiveProfileIds(['client', 'subuser'])

  return dispatchToUserIds(clientIds, (targetUserId) => ({
    type: NotificationType.OFFER_CREATED,
    actorUserId: input.actorUserId,
    title: `New offer: ${input.title}`,
    message: `${input.brand} has published a new offer with ${input.discount}.`,
    link: '/client/offers',
    metadata: {
      offerId: input.offerId,
      title: input.title,
      brand: input.brand,
      discount: input.discount,
      category: input.category,
      targetUserId,
    },
  }))
}

export async function notifyTutorialCreated(input: {
  actorUserId: string
  tutorialId: string
  title: string
  category: string
  description: string
}) {
  const clientIds = await resolveActiveProfileIds(['client', 'subuser'])

  return dispatchToUserIds(clientIds, (targetUserId) => ({
    type: NotificationType.TUTORIAL_CREATED,
    actorUserId: input.actorUserId,
    title: `New tutorial: ${input.title}`,
    message: `A new ${input.category.toLowerCase()} tutorial is now available for the client portal.`,
    link: '/client/tutorials',
    metadata: {
      tutorialId: input.tutorialId,
      title: input.title,
      category: input.category,
      description: input.description,
      targetUserId,
    },
  }))
}
