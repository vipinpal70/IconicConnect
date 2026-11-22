import { REOPEN_WINDOW_DAYS, isAgentRole, isCustomerRole, type SupportStatus } from './constants'
import type { TicketAction } from './types'

/**
 * Who may do what in the support system. Pure functions, no I/O: every route and service call goes
 * through here, so the rules live in exactly one place (support-system.md §2).
 */

export interface SupportActor {
  id: string
  role: string
  /** Effective lab for customers (owner → own id, sub-user → owner's id); null for staff. */
  clientId: string | null
}

export interface TicketAccess {
  clientId: string
  status: SupportStatus
  closedAt: Date | null
  assigneeId: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export const isAgent = (actor: SupportActor) => isAgentRole(actor.role)
export const isCustomer = (actor: SupportActor) => isCustomerRole(actor.role) && Boolean(actor.clientId)

/** Designers and anyone without a lab have no access at all (decision D10). */
export const canUseSupport = (actor: SupportActor) => isAgent(actor) || isCustomer(actor)

/** Customers see every conversation of their lab (decision D2); agents see all (decision D3). */
export function canViewTicket(actor: SupportActor, ticket: Pick<TicketAccess, 'clientId'>): boolean {
  if (isAgent(actor)) return true
  return isCustomer(actor) && ticket.clientId === actor.clientId
}

/** Customers open conversations for their own lab; any agent may open one on a lab's behalf (decision D9). */
export function canCreateTicketFor(actor: SupportActor, clientId: string): boolean {
  if (isAgent(actor)) return true
  return isCustomer(actor) && clientId === actor.clientId
}

export function reopenDeadline(ticket: Pick<TicketAccess, 'status' | 'closedAt'>): Date | null {
  if (ticket.status !== 'closed' || !ticket.closedAt) return null
  return new Date(ticket.closedAt.getTime() + REOPEN_WINDOW_DAYS * DAY_MS)
}

export function customerCanReopen(ticket: Pick<TicketAccess, 'status' | 'closedAt'>, now: Date): boolean {
  const deadline = reopenDeadline(ticket)
  return deadline !== null && now.getTime() <= deadline.getTime()
}

export function allowedActions(actor: SupportActor, ticket: TicketAccess, now: Date): TicketAction[] {
  if (!canViewTicket(actor, ticket)) return []
  const open = ticket.status !== 'closed'
  if (isAgent(actor)) {
    if (!open) return ['reopen']
    const actions: TicketAction[] = ['close', 'assign', 'set_priority', 'set_category']
    if (ticket.assigneeId !== actor.id) actions.push('claim')
    return actions
  }
  if (open) return ['close']
  return customerCanReopen(ticket, now) ? ['reopen'] : []
}

export type PostCheck =
  | { ok: true; reopens: boolean }
  | { ok: false; code: 'not_found' | 'notes_are_for_staff' | 'closed' }

/**
 * May this actor post here? A public message on a closed conversation reopens it: always for agents,
 * for customers only inside the reopen window (after that they start a new, linked conversation).
 * Internal notes are agent-only and never change the status.
 */
export function checkPost(actor: SupportActor, ticket: TicketAccess, visibility: 'public' | 'note', now: Date): PostCheck {
  if (!canViewTicket(actor, ticket)) return { ok: false, code: 'not_found' }
  if (visibility === 'note') return isAgent(actor) ? { ok: true, reopens: false } : { ok: false, code: 'notes_are_for_staff' }
  if (ticket.status !== 'closed') return { ok: true, reopens: false }
  if (isAgent(actor) || customerCanReopen(ticket, now)) return { ok: true, reopens: true }
  return { ok: false, code: 'closed' }
}
