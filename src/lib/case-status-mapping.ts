import type { caseStatusEnum } from '@/src/db/schema/case'

export type StatusViewer = 'admin' | 'client'
export type CaseStatus = (typeof caseStatusEnum.enumValues)[number]

export type StatusActionType =
  | 'normal'
  | 'exception'
  | 'client_action'
  | 'admin_action'

export type StatusEntry = {
  adminLabel: string
  clientLabel: string
  lifecycleStep: string
  clientVisible: boolean
  terminal?: boolean
  actionType?: StatusActionType
}

type FlowMapping = {
  lifecycleSteps: string[]
  statuses: Partial<Record<CaseStatus, StatusEntry>>
}

// Design Only — happy path:
// scan_received -> scan_verified -> allocated_to_designer -> in_progress ->
// internal_qc -> submitted_to_client -> approved
const designOnly: FlowMapping = {
  lifecycleSteps: [
    'Submitted',
    'In Validation',
    'In Design',
    'Internal QC',
    'Pending Client Approval',
    'Completed',
  ],
  statuses: {
    scan_received: { adminLabel: 'Scan Received', clientLabel: 'Case Submitted', lifecycleStep: 'Submitted', clientVisible: true, actionType: 'normal' },
    scan_not_verified: { adminLabel: 'Scan Rejected', clientLabel: 'In Validation', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'exception' },
    scan_verified: { adminLabel: 'Scan Verified', clientLabel: 'Validated', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'admin_action' },
    allocated_to_designer: { adminLabel: 'Allocated to Designer', clientLabel: 'In Design', lifecycleStep: 'In Design', clientVisible: true, actionType: 'normal' },
    in_progress: { adminLabel: 'In Progress', clientLabel: 'In Design', lifecycleStep: 'In Design', clientVisible: true, actionType: 'normal' },
    internal_qc: { adminLabel: 'Internal QC', clientLabel: 'Internal QC', lifecycleStep: 'Internal QC', clientVisible: true, actionType: 'normal' },
    submitted_to_client: { adminLabel: 'Submitted to Client', clientLabel: 'Client Review', lifecycleStep: 'Pending Client Approval', clientVisible: true, actionType: 'client_action' },
    change_requested: { adminLabel: 'Change Requested', clientLabel: 'Change Requested', lifecycleStep: 'Pending Client Approval', clientVisible: true, actionType: 'client_action' },
    client_feedback: { adminLabel: 'Client Feedback', clientLabel: 'Feedback', lifecycleStep: 'In Design', clientVisible: true, actionType: 'normal' },
    approved: { adminLabel: 'Approved', clientLabel: 'Case Approved', lifecycleStep: 'Completed', clientVisible: true, terminal: true, actionType: 'normal' },
    delivered: { adminLabel: 'Delivered', clientLabel: 'Completed', lifecycleStep: 'Completed', clientVisible: true, terminal: true, actionType: 'normal' },
    on_hold: { adminLabel: 'On Hold', clientLabel: 'On Hold', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'exception' },
    cancelled: { adminLabel: 'Cancelled', clientLabel: 'Cancelled', lifecycleStep: 'Completed', clientVisible: true, terminal: true, actionType: 'exception' },
    client_reject: { adminLabel: 'Rejected', clientLabel: 'Rejected', lifecycleStep: 'Completed', clientVisible: true, terminal: true, actionType: 'exception' },
  },
}

export const STATUS_MAPPING: FlowMapping = designOnly

/**
 * Status label. Falls back to the raw status string for legacy or unexpected
 * statuses so existing cases always render.
 */
export function getStatusLabel(status: CaseStatus, viewer: StatusViewer): string {
  const entry = STATUS_MAPPING.statuses[status]
  if (!entry) return status
  return viewer === 'admin' ? entry.adminLabel : entry.clientLabel
}

export function getLifecycleSteps(): string[] {
  return STATUS_MAPPING.lifecycleSteps
}

export function getLifecycleStep(status: CaseStatus): string | undefined {
  return STATUS_MAPPING.statuses[status]?.lifecycleStep
}

export function isStatusAllowed(status: CaseStatus): boolean {
  return status in STATUS_MAPPING.statuses
}
