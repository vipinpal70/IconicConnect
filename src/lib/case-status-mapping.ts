import type { caseStatusEnum } from '@/src/db/schema/case'

export type ServiceType = 'design_only' | 'design_milling' | 'milling_only'
export type StatusViewer = 'admin' | 'client'
export type CaseStatus = (typeof caseStatusEnum.enumValues)[number]

export type StatusActionType =
  | 'normal'
  | 'exception'
  | 'client_action'
  | 'admin_action'
  | 'milling_action'

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
  skippedStatuses: CaseStatus[]
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
  skippedStatuses: ['ready_for_milling', 'milling_in_progress', 'milling_qc', 'packaging', 'dispatched'],
}

// Design + Milling — happy path:
// scan_received -> scan_verified -> allocated_to_designer -> in_progress ->
// internal_qc -> ready_for_milling -> milling_in_progress -> milling_qc ->
// dispatched -> delivered
// There is no client-approval step in this flow — once QC's checklist is
// complete the case goes straight to milling-centre assignment.
const designMilling: FlowMapping = {
  lifecycleSteps: [
    'Submitted',
    'In Validation',
    'In Design',
    'Internal QC',
    'In Production',
    'Dispatched',
    'Delivered',
  ],
  statuses: {
    scan_received: { adminLabel: 'Scan Received', clientLabel: 'Case Submitted', lifecycleStep: 'Submitted', clientVisible: true, actionType: 'normal' },
    scan_not_verified: { adminLabel: 'Scan Rejected', clientLabel: 'In Validation', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'exception' },
    scan_verified: { adminLabel: 'Scan Verified', clientLabel: 'Validated', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'admin_action' },
    allocated_to_designer: { adminLabel: 'Allocated to Designer', clientLabel: 'In Design', lifecycleStep: 'In Design', clientVisible: true, actionType: 'normal' },
    in_progress: { adminLabel: 'In Progress', clientLabel: 'In Design', lifecycleStep: 'In Design', clientVisible: true, actionType: 'normal' },
    internal_qc: { adminLabel: 'Internal QC', clientLabel: 'Internal QC', lifecycleStep: 'Internal QC', clientVisible: true, actionType: 'normal' },
    // submitted_to_client / change_requested / approved are not used by the
    // normal Design + Milling path (no client-approval step), but remain
    // valid states in case an admin manually loops a client in.
    submitted_to_client: { adminLabel: 'Submitted to Client', clientLabel: 'Client Review', lifecycleStep: 'Internal QC', clientVisible: true, actionType: 'client_action' },
    change_requested: { adminLabel: 'Change Requested', clientLabel: 'Change Requested', lifecycleStep: 'Internal QC', clientVisible: true, actionType: 'client_action' },
    client_feedback: { adminLabel: 'Client Feedback', clientLabel: 'Feedback', lifecycleStep: 'In Design', clientVisible: true, actionType: 'normal' },
    approved: { adminLabel: 'Approved', clientLabel: 'Case Approved', lifecycleStep: 'In Production', clientVisible: true, actionType: 'normal' },
    ready_for_milling: { adminLabel: 'Ready for Milling', clientLabel: 'In Production', lifecycleStep: 'In Production', clientVisible: true, actionType: 'admin_action' },
    milling_in_progress: { adminLabel: 'Milling in Progress', clientLabel: 'In Production', lifecycleStep: 'In Production', clientVisible: true, actionType: 'milling_action' },
    milling_qc: { adminLabel: 'Milling QC', clientLabel: 'In Production', lifecycleStep: 'In Production', clientVisible: true, actionType: 'milling_action' },
    dispatched: { adminLabel: 'Dispatched', clientLabel: 'Dispatched', lifecycleStep: 'Dispatched', clientVisible: true, actionType: 'milling_action' },
    delivered: { adminLabel: 'Delivered', clientLabel: 'Delivered', lifecycleStep: 'Delivered', clientVisible: true, terminal: true, actionType: 'milling_action' },
    on_hold: { adminLabel: 'On Hold', clientLabel: 'On Hold', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'exception' },
    cancelled: { adminLabel: 'Cancelled', clientLabel: 'Cancelled', lifecycleStep: 'Terminal Exception', clientVisible: true, terminal: true, actionType: 'exception' },
    client_reject: { adminLabel: 'Rejected', clientLabel: 'Rejected', lifecycleStep: 'Terminal Exception', clientVisible: true, terminal: true, actionType: 'exception' },
  },
  skippedStatuses: ['packaging'],
}

// Milling Only — happy path:
// scan_received -> scan_verified -> ready_for_milling -> milling_in_progress
// -> milling_qc -> dispatched -> delivered
const millingOnly: FlowMapping = {
  lifecycleSteps: [
    'Submitted',
    'In Validation',
    'In Production',
    'Dispatched',
    'Delivered',
  ],
  statuses: {
    scan_received: { adminLabel: 'Mill-Ready File Received', clientLabel: 'File Submitted', lifecycleStep: 'Submitted', clientVisible: true, actionType: 'normal' },
    scan_not_verified: { adminLabel: 'File Rejected', clientLabel: 'File Needs Review', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'exception' },
    scan_verified: { adminLabel: 'File Verified', clientLabel: 'File Verified', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'admin_action' },
    ready_for_milling: { adminLabel: 'Ready for Milling', clientLabel: 'In Production', lifecycleStep: 'In Production', clientVisible: true, actionType: 'admin_action' },
    milling_in_progress: { adminLabel: 'Milling in Progress', clientLabel: 'In Production', lifecycleStep: 'In Production', clientVisible: true, actionType: 'milling_action' },
    milling_qc: { adminLabel: 'Milling QC', clientLabel: 'In Production', lifecycleStep: 'In Production', clientVisible: true, actionType: 'milling_action' },
    dispatched: { adminLabel: 'Dispatched', clientLabel: 'Dispatched', lifecycleStep: 'Dispatched', clientVisible: true, actionType: 'milling_action' },
    delivered: { adminLabel: 'Delivered', clientLabel: 'Delivered', lifecycleStep: 'Delivered', clientVisible: true, terminal: true, actionType: 'milling_action' },
    on_hold: { adminLabel: 'On Hold', clientLabel: 'On Hold', lifecycleStep: 'In Validation', clientVisible: true, actionType: 'exception' },
    cancelled: { adminLabel: 'Cancelled', clientLabel: 'Cancelled', lifecycleStep: 'Terminal Exception', clientVisible: true, terminal: true, actionType: 'exception' },
    // Exception only — not part of the normal Milling Only flow (no design
    // approval step exists for the client to reject from).
    client_reject: { adminLabel: 'Rejected', clientLabel: 'Rejected', lifecycleStep: 'Terminal Exception', clientVisible: true, terminal: true, actionType: 'exception' },
  },
  skippedStatuses: [
    'allocated_to_designer',
    'in_progress',
    'internal_qc',
    'submitted_to_client',
    'change_requested',
    'client_feedback',
    'approved',
    'packaging',
  ],
}

export const STATUS_MAPPING: Record<ServiceType, FlowMapping> = {
  design_only: designOnly,
  design_milling: designMilling,
  milling_only: millingOnly,
}

/**
 * Flow-aware status label. Falls back to the raw status string for legacy
 * or unexpected statuses so existing cases always render.
 */
export function getStatusLabel(serviceType: ServiceType, status: CaseStatus, viewer: StatusViewer): string {
  const entry = STATUS_MAPPING[serviceType].statuses[status]
  if (!entry) return status
  return viewer === 'admin' ? entry.adminLabel : entry.clientLabel
}

export function getLifecycleSteps(serviceType: ServiceType): string[] {
  return STATUS_MAPPING[serviceType].lifecycleSteps
}

export function getLifecycleStep(serviceType: ServiceType, status: CaseStatus): string | undefined {
  return STATUS_MAPPING[serviceType].statuses[status]?.lifecycleStep
}

export function isStatusAllowedForFlow(serviceType: ServiceType, status: CaseStatus): boolean {
  return status in STATUS_MAPPING[serviceType].statuses
}

export function getSkippedStatuses(serviceType: ServiceType): CaseStatus[] {
  return STATUS_MAPPING[serviceType].skippedStatuses
}