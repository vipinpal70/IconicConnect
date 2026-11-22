/**
 * Support system vocabulary shared by the server and the UI (no server imports here).
 * See support-system.md for the design.
 */

export const SUPPORT_STATUSES = ['new', 'live', 'closed'] as const
export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const SUPPORT_CATEGORIES = ['technical', 'billing', 'case', 'account', 'feature_request', 'callback', 'other'] as const
/** Categories a customer picks from when starting a conversation ("callback" has its own button). */
export const CUSTOMER_CATEGORIES = ['technical', 'case', 'billing', 'account', 'feature_request', 'other'] as const
export const SUPPORT_CLOSE_REASONS = ['resolved', 'no_reply', 'duplicate', 'spam'] as const
export const SUPPORT_MESSAGE_KINDS = ['customer', 'agent', 'note', 'system'] as const

export type SupportStatus = (typeof SUPPORT_STATUSES)[number]
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number]
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]
export type SupportCloseReason = (typeof SUPPORT_CLOSE_REASONS)[number]
export type SupportMessageKind = (typeof SUPPORT_MESSAGE_KINDS)[number]
export type SupportSide = 'customer' | 'agent'

/** Roles that work the support inbox (decision D10: designers have no support access). */
export const AGENT_ROLES = ['admin', 'qc', 'account_manager'] as const
export const CUSTOMER_ROLES = ['client', 'subuser'] as const

/** A customer can reopen a closed conversation for this long (decision D4). */
export const REOPEN_WINDOW_DAYS = 14
/** Live conversations waiting on the customer close after this many days without a reply (decision D4). */
export const AUTO_CLOSE_DAYS = 7

export const MAX_SUBJECT_LENGTH = 200
export const MAX_MESSAGE_LENGTH = 10_000

export const STATUS_LABELS: Record<SupportStatus, string> = { new: 'New', live: 'Live', closed: 'Closed' }
export const PRIORITY_LABELS: Record<SupportPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  technical: 'Technical',
  billing: 'Billing',
  case: 'A case',
  account: 'Account & access',
  feature_request: 'Feature request',
  callback: 'Callback request',
  other: 'Other',
}
export const CLOSE_REASON_LABELS: Record<SupportCloseReason, string> = {
  resolved: 'Resolved',
  no_reply: 'No reply',
  duplicate: 'Duplicate',
  spam: 'Spam',
}

export const STATUS_STYLES: Record<SupportStatus, string> = {
  new: 'bg-amber-50 text-amber-800 border-amber-200',
  live: 'bg-sky-50 text-sky-800 border-sky-200',
  closed: 'bg-slate-100 text-slate-700 border-slate-200',
}
export const PRIORITY_STYLES: Record<SupportPriority, string> = {
  low: 'text-slate-600',
  normal: 'text-slate-700',
  high: 'text-orange-700',
  urgent: 'text-red-700 font-semibold',
}

export function formatTicketNumber(n: number): string {
  return `SUP-${String(n).padStart(6, '0')}`
}

export function isAgentRole(role: string | null | undefined): boolean {
  return (AGENT_ROLES as readonly string[]).includes(role ?? '')
}

export function isCustomerRole(role: string | null | undefined): boolean {
  return (CUSTOMER_ROLES as readonly string[]).includes(role ?? '')
}
