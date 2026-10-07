import { isStatusAllowed, STATUS_MAPPING, type CaseStatus } from './case-status-mapping'

export type TransitionCheckInput = {
  currentStatus: CaseStatus
  targetStatus: CaseStatus
}

export type TransitionCheckResult = { allowed: true } | { allowed: false; reason: string }

/**
 * Coarse status guard layered on top of (not replacing) the detailed
 * per-role/per-field authorization already enforced inline in
 * `src/app/api/cases/[id]/route.ts`: the target status must be part of the
 * Design flow (`STATUS_MAPPING`). Anything else — e.g. a legacy milling
 * production status — is rejected.
 */
export function canTransitionCaseStatus(input: TransitionCheckInput): TransitionCheckResult {
  if (!isStatusAllowed(input.targetStatus)) {
    return { allowed: false, reason: `'${input.targetStatus}' is not a valid case status` }
  }
  return { allowed: true }
}

export function getAllowedTargetStatuses(currentStatus: CaseStatus): CaseStatus[] {
  const candidates = Object.keys(STATUS_MAPPING.statuses) as CaseStatus[]
  return candidates.filter((targetStatus) => canTransitionCaseStatus({ currentStatus, targetStatus }).allowed)
}
