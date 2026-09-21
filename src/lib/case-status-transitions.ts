import { isStatusAllowedForFlow, STATUS_MAPPING, type CaseStatus, type ServiceType } from './case-status-mapping'

// Statuses that represent physical production at a milling centre — shared
// by design_milling (right after Internal QC — no client approval step) and
// milling_only (right after file verification).
const MILLING_PRODUCTION_STATUSES: CaseStatus[] = [
  'ready_for_milling',
  'milling_in_progress',
  'milling_qc',
  'dispatched',
  'delivered',
]

export type Role = 'client' | 'subuser' | 'admin' | 'qc' | 'account_manager' | 'designer' | 'consultant' | 'milling_admin' | 'milling_production' | 'milling_support'

const MILLING_ROLES: Role[] = ['milling_admin', 'milling_production', 'milling_support']
const CLIENT_ROLES: Role[] = ['client', 'subuser']

// A milling-portal user acting as a Design Partner (case-flow-update-plan.md
// §6.2) may only ever drive a case between these two design-phase statuses —
// Start Design (allocated_to_designer -> in_progress) and Submit for Review
// (in_progress -> internal_qc). They can never self-allocate
// (allocated_to_designer is set by admin/QC at hand-off) and never touch a
// client-facing or terminal status. Ownership of the actual assignment
// (designCenterId matches their centre) is enforced at the route level, same
// as every other fine-grained rule this coarse guard sits in front of.
const MILLING_DESIGN_ACTIONABLE_TARGETS: CaseStatus[] = ['in_progress', 'internal_qc']

export type TransitionCheckInput = {
  serviceType: ServiceType
  role: Role
  currentStatus: CaseStatus
  targetStatus: CaseStatus
  actorId?: string
  caseRecord?: { designerId?: string | null; qcId?: string | null }
}

export type TransitionCheckResult = { allowed: true } | { allowed: false; reason: string }

/**
 * Additive, flow-aware transition guard layered on top of (not replacing)
 * the detailed per-role/per-field authorization already enforced inline in
 * `src/app/api/cases/[id]/route.ts` and the milling routes. This function
 * only encodes the cross-cutting rules introduced by the 3-flow model
 * (plan.md §10) — it is intentionally coarser than the existing route logic
 * and should be called as an extra check before that logic runs, not in
 * place of it.
 *
 * Note: the "milling portal can only act on their assigned case" rule
 * requires a join against `millingCaseAssignments`, which isn't available
 * to this pure function — callers must fetch and enforce that separately.
 */
export function canTransitionCaseStatus(input: TransitionCheckInput): TransitionCheckResult {
  const { serviceType, role, currentStatus, targetStatus } = input

  if (!isStatusAllowedForFlow(serviceType, targetStatus)) {
    return { allowed: false, reason: `'${targetStatus}' is not part of the ${serviceType} flow` }
  }

  if (CLIENT_ROLES.includes(role) && MILLING_PRODUCTION_STATUSES.includes(targetStatus)) {
    return { allowed: false, reason: 'Clients cannot set milling production statuses directly' }
  }

  if (
    serviceType === 'design_milling' &&
    MILLING_PRODUCTION_STATUSES.includes(targetStatus) &&
    currentStatus !== 'internal_qc' &&
    !MILLING_PRODUCTION_STATUSES.includes(currentStatus)
  ) {
    return { allowed: false, reason: 'Design + Milling cases must complete Internal QC before entering production' }
  }

  if (
    MILLING_ROLES.includes(role) &&
    !MILLING_PRODUCTION_STATUSES.includes(targetStatus) &&
    !MILLING_DESIGN_ACTIONABLE_TARGETS.includes(targetStatus)
  ) {
    return { allowed: false, reason: 'Milling portal users can only set production or design-progress statuses' }
  }

  return { allowed: true }
}

export function getAllowedTargetStatuses(input: Omit<TransitionCheckInput, 'targetStatus'>): CaseStatus[] {
  const candidates = Object.keys(STATUS_MAPPING[input.serviceType].statuses) as CaseStatus[]
  return candidates.filter((targetStatus) => canTransitionCaseStatus({ ...input, targetStatus }).allowed)
}