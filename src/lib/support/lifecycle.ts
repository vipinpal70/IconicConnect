import {
  AUTO_CLOSE_DAYS,
  REOPEN_WINDOW_DAYS,
  CLOSE_REASON_LABELS,
  PRIORITY_LABELS,
  CATEGORY_LABELS,
  type SupportCategory,
  type SupportCloseReason,
  type SupportPriority,
  type SupportSide,
  type SupportStatus,
} from './constants'

/**
 * Status rules of a conversation (support-system.md §4) as pure functions.
 *
 *   NEW ──agent replies / is assigned──► LIVE ──close──► CLOSED ──reopen──► LIVE
 *
 * Each function returns the column changes, the audit events to record and the system lines to post
 * in the thread. The service applies them inside one transaction. Nothing here touches the database.
 */

export interface LifecycleState {
  status: SupportStatus
  assigneeId: string | null
  priority: SupportPriority
  category: SupportCategory
  firstRespondedAt: Date | null
  closedAt: Date | null
  closeReason: SupportCloseReason | null
  reopenedCount: number
  linkedTicketId?: string | null
}

export interface LifecyclePatch {
  linkedTicketId?: string | null
  status?: SupportStatus
  assigneeId?: string | null
  priority?: SupportPriority
  category?: SupportCategory
  firstRespondedAt?: Date
  closedAt?: Date | null
  closedBy?: string | null
  closeReason?: SupportCloseReason | null
  reopenedCount?: number
}

export type LifecycleEventType = 'status' | 'assignee' | 'priority' | 'category' | 'reopened' | 'linked' | 'auto_closed' | 'rated'

export interface LifecycleResult {
  patch: LifecyclePatch
  events: Array<{ type: LifecycleEventType; from: string | null; to: string | null }>
  /** Public, centred lines in the thread ("Conversation closed"). Customers see these. */
  systemMessages: string[]
}

export type ActionInput =
  | { action: 'close'; reason?: SupportCloseReason }
  | { action: 'reopen' }
  | { action: 'assign'; assigneeId: string | null; assigneeName?: string | null }
  | { action: 'claim' }
  | { action: 'set_priority'; priority: SupportPriority }
  | { action: 'set_category'; category: SupportCategory }
  | { action: 'link'; linkedTicketId: string | null; linkedNumber: string | null; previousNumber?: string | null }

export type ActionOutcome = { ok: true; result: LifecycleResult } | { ok: false; code: 'no_change' | 'invalid_state' }

const empty = (): LifecycleResult => ({ patch: {}, events: [], systemMessages: [] })
const DAY_MS = 24 * 60 * 60 * 1000

function reopen(state: LifecycleState, result: LifecycleResult, actorName: string) {
  result.patch.status = 'live'
  result.patch.closedAt = null
  result.patch.closedBy = null
  result.patch.closeReason = null
  result.patch.reopenedCount = state.reopenedCount + 1
  result.events.push({ type: 'reopened', from: 'closed', to: 'live' })
  result.systemMessages.push(`Conversation reopened by ${actorName}`)
}

/** A public message was posted. `reopens` comes from the policy check (closed + allowed to reopen). */
export function onPublicMessage(
  state: LifecycleState,
  side: SupportSide,
  now: Date,
  opts: { reopens: boolean; actorName: string },
): LifecycleResult {
  const result = empty()
  if (opts.reopens && state.status === 'closed') reopen(state, result, opts.actorName)
  if (side === 'agent') {
    if (state.status === 'new') {
      result.patch.status = 'live'
      result.events.push({ type: 'status', from: 'new', to: 'live' })
    }
    if (!state.firstRespondedAt) result.patch.firstRespondedAt = now
  }
  return result
}

/**
 * Auto-close (support-system.md §4): a Live conversation waiting on the lab gets a public warning one day
 * before it closes, then closes as "No reply". Any public message in between cancels it.
 */
export function shouldWarnAutoClose(
  t: { status: SupportStatus; lastPublicSender: SupportSide | null; lastAgentReplyAt: Date | null; autoCloseWarnedAt: Date | null },
  now: Date,
): boolean {
  if (t.status !== 'live' || t.lastPublicSender !== 'agent' || !t.lastAgentReplyAt || t.autoCloseWarnedAt) return false
  return now.getTime() - t.lastAgentReplyAt.getTime() >= (AUTO_CLOSE_DAYS - 1) * DAY_MS
}

export function shouldAutoClose(
  t: { status: SupportStatus; lastPublicSender: SupportSide | null; autoCloseWarnedAt: Date | null },
  now: Date,
): boolean {
  if (t.status !== 'live' || t.lastPublicSender !== 'agent' || !t.autoCloseWarnedAt) return false
  return now.getTime() - t.autoCloseWarnedAt.getTime() >= DAY_MS
}

export const AUTO_CLOSE_WARNING =
  "We haven't heard back, so this conversation will close automatically tomorrow. Reply here to keep it open."

export function onAutoClose(state: LifecycleState, now: Date): LifecycleResult {
  const result = empty()
  result.patch = { status: 'closed', closedAt: now, closedBy: null, closeReason: 'no_reply' }
  result.events.push({ type: 'auto_closed', from: state.status, to: 'closed' })
  result.systemMessages.push(
    `Conversation closed automatically after ${AUTO_CLOSE_DAYS} days without a reply. Reply within ${REOPEN_WINDOW_DAYS} days to reopen it.`,
  )
  return result
}

export function onAction(
  state: LifecycleState,
  input: ActionInput,
  actor: { id: string; name: string },
  now: Date,
): ActionOutcome {
  const result = empty()
  switch (input.action) {
    case 'close': {
      if (state.status === 'closed') return { ok: false, code: 'invalid_state' }
      const reason = input.reason ?? 'resolved'
      result.patch = { status: 'closed', closedAt: now, closedBy: actor.id, closeReason: reason }
      result.events.push({ type: 'status', from: state.status, to: 'closed' })
      result.systemMessages.push(`Conversation closed by ${actor.name} (${CLOSE_REASON_LABELS[reason]})`)
      return { ok: true, result }
    }
    case 'reopen': {
      if (state.status !== 'closed') return { ok: false, code: 'invalid_state' }
      reopen(state, result, actor.name)
      return { ok: true, result }
    }
    case 'claim':
      return onAction(state, { action: 'assign', assigneeId: actor.id, assigneeName: actor.name }, actor, now)
    case 'assign': {
      if (state.status === 'closed') return { ok: false, code: 'invalid_state' }
      if (state.assigneeId === input.assigneeId) return { ok: false, code: 'no_change' }
      result.patch.assigneeId = input.assigneeId
      result.events.push({ type: 'assignee', from: state.assigneeId, to: input.assigneeId })
      result.systemMessages.push(
        input.assigneeId ? `${input.assigneeName || 'A support agent'} is now handling this conversation` : 'Conversation unassigned',
      )
      if (input.assigneeId && state.status === 'new') {
        result.patch.status = 'live'
        result.events.push({ type: 'status', from: 'new', to: 'live' })
      }
      return { ok: true, result }
    }
    case 'set_priority': {
      if (state.priority === input.priority) return { ok: false, code: 'no_change' }
      result.patch.priority = input.priority
      // Internal triage: audited, but not announced in the thread
      result.events.push({ type: 'priority', from: PRIORITY_LABELS[state.priority], to: PRIORITY_LABELS[input.priority] })
      return { ok: true, result }
    }
    case 'set_category': {
      if (state.category === input.category) return { ok: false, code: 'no_change' }
      result.patch.category = input.category
      result.events.push({ type: 'category', from: CATEGORY_LABELS[state.category], to: CATEGORY_LABELS[input.category] })
      return { ok: true, result }
    }
    case 'link': {
      if ((state.linkedTicketId ?? null) === input.linkedTicketId) return { ok: false, code: 'no_change' }
      result.patch.linkedTicketId = input.linkedTicketId
      // Audited; both sides see the link in the header, so no thread line is needed
      result.events.push({ type: 'linked', from: input.previousNumber ?? null, to: input.linkedNumber })
      return { ok: true, result }
    }
  }
}
