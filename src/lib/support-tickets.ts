export const SUPPORT_TICKET_TYPES = [
  'technical',
  'billing',
  'case_issue',
  'feature_request',
  'account_access',
  'other',
] as const

export type SupportTicketType = (typeof SUPPORT_TICKET_TYPES)[number]

export const SUPPORT_TICKET_PRIORITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const

export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number]

export const SUPPORT_TICKET_STATUSES = [
  'open',
  'in_progress',
  'awaiting_client',
  'resolved',
  'closed',
] as const

export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number]

export const CLIENT_SUPPORT_STATUS_OPTIONS = [
  'open',
  'resolved',
  'closed',
] as const

export const SUPPORT_TICKET_TYPE_LABELS: Record<SupportTicketType, string> = {
  technical: 'Technical',
  billing: 'Billing',
  case_issue: 'Case Issue',
  feature_request: 'Feature Request',
  account_access: 'Account Access',
  other: 'Other',
}

export const SUPPORT_TICKET_PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export const SUPPORT_TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  awaiting_client: 'Awaiting Client',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const SUPPORT_TICKET_STATUS_STYLES: Record<SupportTicketStatus, string> = {
  open: 'bg-amber-50 text-amber-700 border border-amber-100',
  in_progress: 'bg-sky-50 text-sky-700 border border-sky-100',
  awaiting_client: 'bg-violet-50 text-violet-700 border border-violet-100',
  resolved: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  closed: 'bg-slate-100 text-slate-700 border border-slate-200',
}

export function isClientSupportStatus(status: string): status is typeof CLIENT_SUPPORT_STATUS_OPTIONS[number] {
  return (CLIENT_SUPPORT_STATUS_OPTIONS as readonly string[]).includes(status)
}

export function supportTicketLabel(value: string, labels: Record<string, string>) {
  return labels[value] || value
}
