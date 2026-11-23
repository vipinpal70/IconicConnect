import type { SupportPriority } from './constants'

/**
 * Reply-time rules (support-system.md §10) as pure functions. No database access here.
 *
 * The reply clock runs while the lab is waiting on support: it starts at the first unanswered lab message
 * and stops when support replies in public or the conversation closes. Internal notes don't stop it.
 * Before the first support reply the "first response" target applies, after it the "next response" one.
 * Wall-clock time for now (decision D5: no business hours yet).
 */

export interface SlaPolicy {
  firstResponseMinutes: number
  nextResponseMinutes: number
}

export const DEFAULT_SLA_POLICIES: Record<SupportPriority, SlaPolicy> = {
  urgent: { firstResponseMinutes: 60, nextResponseMinutes: 120 },
  high: { firstResponseMinutes: 240, nextResponseMinutes: 480 },
  normal: { firstResponseMinutes: 480, nextResponseMinutes: 1440 },
  low: { firstResponseMinutes: 1440, nextResponseMinutes: 2880 },
}

/** Share of the allowed time after which the assignee is warned. */
export const SLA_WARN_RATIO = 0.8

export type SlaAlertLevel = 0 | 1 | 2 // none sent / "due soon" sent / "overdue" sent

export interface SlaColumns {
  slaStartedAt: Date | null
  replyDueAt: Date | null
  replyWarnAt: Date | null
  slaAlertLevel: SlaAlertLevel
}

export const SLA_STOPPED: SlaColumns = { slaStartedAt: null, replyDueAt: null, replyWarnAt: null, slaAlertLevel: 0 }

/** Deadlines for a clock that started at `startedAt`. */
export function slaDeadlines(startedAt: Date, policy: SlaPolicy, firstResponded: boolean) {
  const minutes = firstResponded ? policy.nextResponseMinutes : policy.firstResponseMinutes
  return {
    dueAt: new Date(startedAt.getTime() + minutes * 60_000),
    warnAt: new Date(startedAt.getTime() + Math.round(minutes * SLA_WARN_RATIO * 60_000)),
  }
}

export interface SlaClockInput {
  status: 'new' | 'live' | 'closed'
  priority: SupportPriority
  /** Who spoke last in public, after the change. */
  lastPublicSender: 'customer' | 'agent' | null
  firstResponded: boolean
  /** The clock before the change. */
  current: SlaColumns
}

/**
 * The clock after a change. Keeps an already-running clock (a second lab message doesn't buy support
 * more time), starts one when the lab is newly waiting, stops it otherwise. When the deadline itself
 * moves (new start, priority change, first reply given) alerts are re-armed.
 */
export function nextSlaClock(input: SlaClockInput, policy: SlaPolicy, now: Date): SlaColumns {
  const waitingOnSupport = input.status !== 'closed' && input.lastPublicSender === 'customer'
  if (!waitingOnSupport) return SLA_STOPPED
  const startedAt = input.current.slaStartedAt ?? now
  const { dueAt, warnAt } = slaDeadlines(startedAt, policy, input.firstResponded)
  const unchanged = input.current.replyDueAt?.getTime() === dueAt.getTime()
  return { slaStartedAt: startedAt, replyDueAt: dueAt, replyWarnAt: warnAt, slaAlertLevel: unchanged ? input.current.slaAlertLevel : 0 }
}

export type SlaState = 'on_track' | 'due_soon' | 'overdue'

export function slaState(dueAt: Date | null, warnAt: Date | null, now: Date): SlaState | null {
  if (!dueAt || !warnAt) return null
  if (now >= dueAt) return 'overdue'
  if (now >= warnAt) return 'due_soon'
  return 'on_track'
}

/** "45m", "3h", "2h 10m", "2d" — compact, for badges. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest && hours < 10 ? `${hours}h ${rest}m` : `${hours}h`
  }
  return `${Math.round(hours / 24)}d`
}
