import {
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
}

export interface LifecyclePatch {
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

export type LifecycleEventType = 'status' | 'assignee' | 'priority' | 'category' | 'reopened'

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

export type ActionOutcome = { ok: true; result: LifecycleResult } | { ok: false; code: 'no_change' | 'invalid_state' }

const empty = (): LifecycleResult => ({ patch: {}, events: [], systemMessages: [] })

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
  }
}
