import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles, type Profile } from '@/src/db/schema/profile'
import {
  millingCaseAssignments,
  millingCenters,
  caseCenterAssignmentHistory,
  type MillingCaseAssignment,
} from '@/src/db/schema/milling'
import { notifyDesignCentre } from '@/src/lib/notifications/notification-dispatcher'

/**
 * Core read/write logic for the design-partner flow (case-flow-update-plan.md
 * §5, §7). Shared by the design-assign route, the (refactored) milling-assign
 * route, and the Flow-3 auto-advance trigger fired from the approval-checklist
 * route — so there is exactly one place that knows how to mutate
 * milling_case_assignments and write its history trail.
 */

export function buildShipTo(client: Profile) {
  const shipToName = client.labName || client.fullName || null
  const shipToAddress =
    [client.city, client.state, client.postalCode, client.country].filter(Boolean).join(', ') || null
  return { shipToName, shipToAddress }
}

async function recordHistory(entry: {
  caseId: string
  role: 'design' | 'milling'
  action: 'assigned' | 'reassigned' | 'withdrawn' | 'auto_advanced'
  centerId: string | null
  previousCenterId: string | null
  actorId: string | null
  reason?: string | null
}) {
  await db.insert(caseCenterAssignmentHistory).values({
    caseId: entry.caseId,
    role: entry.role,
    action: entry.action,
    millingCenterId: entry.centerId,
    previousCenterId: entry.previousCenterId,
    actorId: entry.actorId,
    reason: entry.reason ?? null,
  })
}

async function getAssignment(caseId: string): Promise<MillingCaseAssignment | null> {
  const [row] = await db.select().from(millingCaseAssignments).where(eq(millingCaseAssignments.caseId, caseId)).limit(1)
  return row ?? null
}

/**
 * Hand a case to a Design+Milling-enabled centre for the DESIGN leg
 * (Flow 1 / Flow 3 — case-flow-update-plan.md §7.2/§7.3). Only callable
 * while the case is at `scan_verified` or being re-allocated from
 * `on_hold`/`client_feedback`/`client_reject` — same eligible-status set the
 * internal-designer allocation already uses. Sets `cases.status =
 * 'allocated_to_designer'`, `cases.designSource = 'partner'`, and (if
 * `qcId` is given) the QC lead in the same action, since a partner centre
 * has no way to pick one itself.
 */
export async function assignDesignCentre(params: {
  caseId: string
  centerId: string
  qcId: string
  autoAdvanceToMilling: boolean
  actorId: string
  notes?: string | null
}) {
  const existing = await getAssignment(params.caseId)
  const previousDesignCenterId = existing?.designCenterId ?? null

  const scope = params.autoAdvanceToMilling ? ('design_milling' as const) : ('design' as const)
  const values = {
    caseId: params.caseId,
    scope,
    designCenterId: params.centerId,
    // Flow 3 commits the production leg to the same centre immediately —
    // millingStatus stays null until QC actually approves and the case
    // enters production (autoAdvanceIfCommitted below), so the portal's
    // "in production" queue isn't populated prematurely.
    productionCenterId: params.autoAdvanceToMilling ? params.centerId : existing?.productionCenterId ?? null,
    autoAdvanceToMilling: params.autoAdvanceToMilling,
    notes: params.notes ?? existing?.notes ?? null,
    designAssignedAt: new Date(),
  }

  if (existing) {
    await db.update(millingCaseAssignments).set(values).where(eq(millingCaseAssignments.caseId, params.caseId))
  } else {
    await db.insert(millingCaseAssignments).values(values)
  }

  await db
    .update(cases)
    .set({ status: 'allocated_to_designer', designSource: 'partner', qcId: params.qcId, updatedAt: new Date() })
    .where(eq(cases.id, params.caseId))

  await recordHistory({
    caseId: params.caseId,
    role: 'design',
    action: previousDesignCenterId ? 'reassigned' : 'assigned',
    centerId: params.centerId,
    previousCenterId: previousDesignCenterId,
    actorId: params.actorId,
  })

  if (previousDesignCenterId && previousDesignCenterId !== params.centerId) {
    await notifyDesignCentre(previousDesignCenterId, params.caseId, 'withdrawn', params.actorId).catch(() => {})
  }
  await notifyDesignCentre(params.centerId, params.caseId, 'assigned', params.actorId).catch(() => {})
}

/**
 * Pull a case back from a design-partner centre to an internal designer
 * (case-flow-update-plan.md §13.2 #8) — e.g. the centre is unresponsive.
 * Only valid before the centre has started (`allocated_to_designer`) or
 * while re-allocating from an exception status; a case already `in_progress`
 * at the centre must go On Hold first (§13.1 #4), same rule as reassigning
 * to a different centre.
 */
export async function withdrawDesignCentreToInternal(params: { caseId: string; designerId: string; actorId: string }) {
  const existing = await getAssignment(params.caseId)
  if (!existing?.designCenterId) return

  await db
    .update(millingCaseAssignments)
    .set({ designCenterId: null, autoAdvanceToMilling: false, scope: existing.productionCenterId ? 'milling' : 'design' })
    .where(eq(millingCaseAssignments.caseId, params.caseId))

  await db
    .update(cases)
    .set({ designSource: 'internal', designerId: params.designerId, updatedAt: new Date() })
    .where(eq(cases.id, params.caseId))

  await recordHistory({
    caseId: params.caseId,
    role: 'design',
    action: 'withdrawn',
    centerId: null,
    previousCenterId: existing.designCenterId,
    actorId: params.actorId,
  })

  await notifyDesignCentre(existing.designCenterId, params.caseId, 'withdrawn', params.actorId).catch(() => {})
}

/**
 * Assign (or reassign) the PRODUCTION leg of a case to a centre — the
 * existing Flow 2 action ("Assign to Milling Centre"), now also reusable
 * for Flow 1's deferred milling decision and for an admin/QC override of a
 * Flow-3 commitment (§13.4 #14). Always recomputes `scope` from whichever
 * centre ends up on each leg.
 */
export async function assignProductionCentre(params: {
  caseId: string
  centerId: string
  actorId: string
  notes?: string | null
}) {
  const existing = await getAssignment(params.caseId)
  const previousProductionCenterId = existing?.productionCenterId ?? null
  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, params.caseId)).limit(1)
  const [client] = caseRecord
    ? await db.select().from(profiles).where(eq(profiles.id, caseRecord.clientId)).limit(1)
    : []

  const { shipToName, shipToAddress } = client ? buildShipTo(client) : { shipToName: null, shipToAddress: null }
  const scope = existing?.designCenterId
    ? existing.designCenterId === params.centerId
      ? ('design_milling' as const)
      : ('milling' as const)
    : ('milling' as const)

  const values = {
    caseId: params.caseId,
    scope,
    designCenterId: existing?.designCenterId ?? null,
    productionCenterId: params.centerId,
    autoAdvanceToMilling: existing?.autoAdvanceToMilling ?? false,
    millingStatus: 'ready_for_milling' as const,
    notes: params.notes ?? existing?.notes ?? null,
    shipToName,
    shipToAddress,
    designAssignedAt: existing?.designAssignedAt ?? null,
    productionAssignedAt: new Date(),
  }

  if (existing) {
    await db.update(millingCaseAssignments).set(values).where(eq(millingCaseAssignments.caseId, params.caseId))
  } else {
    await db.insert(millingCaseAssignments).values(values)
  }

  await db.update(cases).set({ status: 'ready_for_milling', updatedAt: new Date() }).where(eq(cases.id, params.caseId))

  await recordHistory({
    caseId: params.caseId,
    role: 'milling',
    action: previousProductionCenterId ? 'reassigned' : 'assigned',
    centerId: params.centerId,
    previousCenterId: previousProductionCenterId,
    actorId: params.actorId,
  })
}

/**
 * Flow 3's system-triggered hand-off (case-flow-update-plan.md §7.3, §13.4
 * #13) — called right after QC's approval-checklist completes for a
 * design_milling case. If the case's assignment was committed up front
 * (`autoAdvanceToMilling`), sends it straight into production under the same
 * centre with no separate admin action. Re-validates the centre is still
 * active first; if not, it gracefully degrades into Flow 1's deferred path
 * instead of assigning a dead centre — the case is left at `internal_qc`
 * for admin/QC to assign production manually.
 *
 * Returns `true` if it auto-advanced the case, `false` if there was nothing
 * to do (not a Flow-3 case) or the committed centre is no longer usable.
 */
export async function autoAdvanceIfCommitted(params: { caseId: string; actorId: string | null }): Promise<boolean> {
  const existing = await getAssignment(params.caseId)
  if (!existing?.autoAdvanceToMilling || !existing.productionCenterId) return false

  const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, existing.productionCenterId)).limit(1)
  if (!center || !center.active) return false

  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, params.caseId)).limit(1)
  const [client] = caseRecord
    ? await db.select().from(profiles).where(eq(profiles.id, caseRecord.clientId)).limit(1)
    : []
  const { shipToName, shipToAddress } = client ? buildShipTo(client) : { shipToName: null, shipToAddress: null }

  await db
    .update(millingCaseAssignments)
    .set({
      millingStatus: 'ready_for_milling',
      productionAssignedAt: new Date(),
      shipToName,
      shipToAddress,
    })
    .where(eq(millingCaseAssignments.caseId, params.caseId))

  await db.update(cases).set({ status: 'ready_for_milling', updatedAt: new Date() }).where(eq(cases.id, params.caseId))

  await recordHistory({
    caseId: params.caseId,
    role: 'milling',
    action: 'auto_advanced',
    centerId: existing.productionCenterId,
    previousCenterId: null,
    actorId: params.actorId,
  })

  return true
}
