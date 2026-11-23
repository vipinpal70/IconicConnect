import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { NotificationService } from '@/src/lib/notifications/notification-service'
import { NotificationType } from '@/src/lib/notifications/notification-events'
import { AGENT_ROLES, isCustomerRole, type SupportSide } from './constants'

/**
 * Who hears about what (support-system.md §10), through the existing notification service.
 * Customer side: the lab owner plus the lab member who started the conversation.
 * Support side: the assignee, or every active agent while nobody is assigned.
 * Internal notes never notify customers. Failures are logged, never thrown: a notification problem
 * must not fail the action that triggered it.
 */

export interface NotifyTicket {
  id: string
  number: string
  subject: string
  clientId: string
  createdBy: string | null
  assigneeId: string | null
}

export interface NotifyActor {
  id: string
  name: string
  side: SupportSide
}

function linkFor(role: string, ticketId: string) {
  const query = `?ticket=${ticketId}`
  if (role === 'admin') return `/admin/support${query}`
  if (isCustomerRole(role)) return `/client/support${query}`
  return `/support${query}`
}

async function customerTargets(ticket: NotifyTicket): Promise<string[]> {
  const ids = new Set([ticket.clientId])
  if (ticket.createdBy && ticket.createdBy !== ticket.clientId) {
    const [creator] = await db
      .select({ role: profiles.role, clientId: profiles.clientId })
      .from(profiles)
      .where(eq(profiles.id, ticket.createdBy))
      .limit(1)
    if (creator && isCustomerRole(creator.role) && creator.clientId === ticket.clientId) ids.add(ticket.createdBy)
  }
  return [...ids]
}

async function agentTargets(ticket: NotifyTicket): Promise<string[]> {
  if (ticket.assigneeId) return [ticket.assigneeId]
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.status, 'active'), inArray(profiles.role, [...AGENT_ROLES])))
  return rows.map((r) => r.id)
}

async function send(
  targetIds: string[],
  actorId: string,
  build: (role: string) => { type: NotificationType; title: string; message: string; link: string },
  ticket: NotifyTicket,
) {
  const targets = targetIds.filter((id) => id !== actorId)
  if (targets.length === 0) return
  try {
    const roles = await db
      .select({ id: profiles.id, role: profiles.role })
      .from(profiles)
      .where(and(inArray(profiles.id, targets), eq(profiles.status, 'active')))
    await NotificationService.dispatchMany(
      roles.map(({ id, role }) => {
        const payload = build(role)
        return {
          ...payload,
          link: payload.link,
          // The dispatcher drops payloads without an actor; scheduled jobs act as "system"
          actorUserId: actorId || 'system',
          targetUserId: id,
          entityId: ticket.id,
          entityType: 'support_ticket',
          metadata: { ticketId: ticket.id, ticketNumber: ticket.number },
        }
      }),
    )
  } catch (error) {
    console.error('[support notify]', error)
  }
}

const excerpt = (text: string) => (text.length > 140 ? `${text.slice(0, 137)}…` : text)
const otherSide = (actor: NotifyActor, ticket: NotifyTicket) =>
  actor.side === 'customer' ? agentTargets(ticket) : customerTargets(ticket)

export async function notifyTicketCreated(ticket: NotifyTicket, actor: NotifyActor, labName: string) {
  const targets = await otherSide(actor, ticket)
  await send(targets, actor.id, (role) => ({
    type: NotificationType.SUPPORT_TICKET_CREATED,
    title: actor.side === 'customer' ? `New conversation ${ticket.number}` : `Support started a conversation (${ticket.number})`,
    message: actor.side === 'customer' ? `${labName}: "${ticket.subject}"` : `"${ticket.subject}"`,
    link: linkFor(role, ticket.id),
  }), ticket)
}

export async function notifyNewMessage(ticket: NotifyTicket, actor: NotifyActor, body: string) {
  const targets = await otherSide(actor, ticket)
  await send(targets, actor.id, (role) => ({
    type: NotificationType.SUPPORT_MESSAGE,
    title: `${actor.name} replied in ${ticket.number}`,
    message: excerpt(body),
    link: linkFor(role, ticket.id),
  }), ticket)
}

export async function notifyStatusChange(ticket: NotifyTicket, actor: NotifyActor, change: 'closed' | 'reopened') {
  const targets = await otherSide(actor, ticket)
  await send(targets, actor.id, (role) => ({
    type: change === 'closed' ? NotificationType.SUPPORT_TICKET_CLOSED : NotificationType.SUPPORT_TICKET_UPDATED,
    title: `Conversation ${ticket.number} ${change}`,
    message: `"${ticket.subject}" was ${change} by ${actor.name}.`,
    link: linkFor(role, ticket.id),
  }), ticket)
}

export async function notifyAssigned(ticket: NotifyTicket, actor: NotifyActor) {
  if (!ticket.assigneeId) return
  await send([ticket.assigneeId], actor.id, (role) => ({
    type: NotificationType.SUPPORT_TICKET_UPDATED,
    title: `${ticket.number} assigned to you`,
    message: `${actor.name} assigned "${ticket.subject}" to you.`,
    link: linkFor(role, ticket.id),
  }), ticket)
}

/** Scheduled jobs act as nobody in particular. */
const SYSTEM_ACTOR_ID = ''

/** Reply-time alerts: the assignee, or every agent while nobody has picked it up. In-app only. */
export async function notifySlaAlert(ticket: NotifyTicket, level: 1 | 2, dueAt: Date) {
  const targets = await agentTargets(ticket)
  const minutes = Math.max(1, Math.round(Math.abs(dueAt.getTime() - Date.now()) / 60_000))
  const span = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
  await send(targets, SYSTEM_ACTOR_ID, (role) => ({
    type: NotificationType.SUPPORT_SLA_ALERT,
    title: level === 2 ? `Reply overdue: ${ticket.number}` : `Reply due soon: ${ticket.number}`,
    message: level === 2 ? `"${ticket.subject}" is waiting for a reply (overdue).` : `"${ticket.subject}" needs a reply within ${span}.`,
    link: linkFor(role, ticket.id),
  }), ticket)
}

export async function notifyAutoCloseWarning(ticket: NotifyTicket) {
  const targets = await customerTargets(ticket)
  await send(targets, SYSTEM_ACTOR_ID, (role) => ({
    type: NotificationType.SUPPORT_TICKET_UPDATED,
    title: `${ticket.number} will close tomorrow`,
    message: `We haven't heard back about "${ticket.subject}". Reply to keep the conversation open.`,
    link: linkFor(role, ticket.id),
  }), ticket)
}

export async function notifyAutoClosed(ticket: NotifyTicket) {
  const targets = await customerTargets(ticket)
  await send(targets, SYSTEM_ACTOR_ID, (role) => ({
    type: NotificationType.SUPPORT_TICKET_CLOSED,
    title: `Conversation ${ticket.number} closed`,
    message: `"${ticket.subject}" was closed after a week without a reply. Reply within two weeks to reopen it.`,
    link: linkFor(role, ticket.id),
  }), ticket)
}

/** The assignee hears how the lab rated the conversation. */
export async function notifyRated(ticket: NotifyTicket, actor: NotifyActor, score: number) {
  if (!ticket.assigneeId) return
  await send([ticket.assigneeId], actor.id, (role) => ({
    type: NotificationType.SUPPORT_TICKET_UPDATED,
    title: `${ticket.number} rated ${score}/5`,
    message: `${actor.name} rated "${ticket.subject}" ${score} out of 5.`,
    link: linkFor(role, ticket.id),
  }), ticket)
}
