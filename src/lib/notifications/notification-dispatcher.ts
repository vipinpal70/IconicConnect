import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { NotificationType } from './notification-events'
import { NotificationService } from './notification-service'

type PortalRole = 'admin' | 'qc' | 'account_manager' | 'client' | 'subuser' | 'consultant'

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
  const adminIds = await resolveActiveProfileIds(['admin', 'qc', 'account_manager', 'consultant'])

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

export async function notifyCaseSubmitted(input: {
  actorUserId: string
  caseId: string
  caseNumber: string
  category: string
  clientName: string
}) {
  const adminIds = await resolveActiveProfileIds(['admin', 'qc', 'account_manager', 'consultant'])

  return dispatchToUserIds(adminIds, (targetUserId) => ({
    type: NotificationType.CASE_CREATED,
    actorUserId: input.actorUserId,
    title: `New case submitted: ${input.caseNumber}`,
    message: `${input.clientName} submitted a new ${input.category} case.`,
    link: '/admin/cases',
    metadata: {
      caseId: input.caseId,
      caseNumber: input.caseNumber,
      category: input.category,
      targetUserId,
    },
  }))
}

export async function notifyCaseStatusChanged(input: {
  actorUserId: string
  targetUserId: string
  caseId: string
  caseNumber: string
  status: string
  clientName?: string
}) {
  const statusLabel = input.status.replace(/_/g, ' ')
  const statusKey = input.status.toLowerCase()
  let type = NotificationType.CASE_STATUS_CHANGED
  let title = `Case ${input.caseNumber} status updated`
  let message = input.clientName
    ? `${input.clientName}'s case ${input.caseNumber} is now ${statusLabel}.`
    : `Your case ${input.caseNumber} is now ${statusLabel}.`

  if (statusKey === 'approved') {
    type = NotificationType.CASE_APPROVED
    title = `Case ${input.caseNumber} approved`
    message = input.clientName
      ? `${input.clientName}'s case ${input.caseNumber} has been approved.`
      : `Your case ${input.caseNumber} has been approved.`
  } else if (statusKey === 'client_feedback') {
    type = NotificationType.CASE_FEEDBACK
    title = `Case ${input.caseNumber} feedback received`
    message = input.clientName
      ? `${input.clientName}'s case ${input.caseNumber} has new feedback.`
      : `Your case ${input.caseNumber} has new feedback.`
  } else if (statusKey === 'on_hold') {
    type = NotificationType.CASE_HOLD
    title = `Case ${input.caseNumber} placed on hold`
    message = input.clientName
      ? `${input.clientName}'s case ${input.caseNumber} has been placed on hold.`
      : `Your case ${input.caseNumber} has been placed on hold.`
  } else if (statusKey === 'cancelled') {
    type = NotificationType.CASE_CANCEL
    title = `Case ${input.caseNumber} cancelled`
    message = input.clientName
      ? `${input.clientName}'s case ${input.caseNumber} has been cancelled.`
      : `Your case ${input.caseNumber} has been cancelled.`
  }

  return NotificationService.dispatch({
    type,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    title,
    message,
    link: '/client/cases',
    metadata: {
      caseId: input.caseId,
      caseNumber: input.caseNumber,
      status: input.status,
    },
  })
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
  const adminIds = await resolveActiveProfileIds(['admin', 'qc', 'account_manager', 'consultant'])

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
