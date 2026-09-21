import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { millingCaseAssignments, millingCenters } from '@/src/db/schema/milling'
import { requireStaffRole } from '@/src/lib/milling/admin-guard'
import { getEligibleCenters } from '@/src/lib/milling/eligibility'
import { assignDesignCentre, withdrawDesignCentreToInternal } from '@/src/lib/milling/assignment'
import { logActivity } from '@/src/lib/activity-log'
import { invalidateCasesCache, deleteCachedData } from '@/src/lib/redis-cache'

// Only admin/qc may hand a case to a design partner — case-flow-update-plan.md
// §6.1. Unlike production assignment, a designer cannot self-serve this
// (there's no partner-centre equivalent of designer self-allocation).
const ASSIGN_ROLES = ['admin', 'qc']

// Statuses from which the design leg may be (re-)assigned/withdrawn. Mirrors
// the internal-designer re-allocation eligibility already used by the qc
// branch of PUT /api/cases/[id] (route.ts's `allocated_to_designer` target
// list: scan_received/scan_verified/client_feedback/client_reject/on_hold).
// 'in_progress'/'internal_qc' are deliberately excluded — case-flow-update-plan.md
// §13.1 #4: once the centre has started, the case must go On Hold first.
const DESIGN_ASSIGNABLE_STATUSES = [
  'scan_received',
  'scan_verified',
  'allocated_to_designer',
  'on_hold',
  'client_feedback',
  'client_reject',
]

async function getDesignableCase(id: string) {
  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
  if (!caseRecord || (caseRecord.serviceType !== 'design_only' && caseRecord.serviceType !== 'design_milling')) return null
  return caseRecord
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffRole(ASSIGN_ROLES)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const caseRecord = await getDesignableCase(id)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Design Only or Design + Milling case not found' }, { status: 404 })
    }

    const [assignment] = await db
      .select({
        designCenterId: millingCaseAssignments.designCenterId,
        designCenterName: millingCenters.name,
        autoAdvanceToMilling: millingCaseAssignments.autoAdvanceToMilling,
        designAssignedAt: millingCaseAssignments.designAssignedAt,
      })
      .from(millingCaseAssignments)
      .leftJoin(millingCenters, eq(millingCenters.id, millingCaseAssignments.designCenterId))
      .where(eq(millingCaseAssignments.caseId, id))
      .limit(1)

    const eligibleCenters = await getEligibleCenters({
      category: caseRecord.category ?? '',
      subTypeData: caseRecord.subTypeData,
      serviceType: caseRecord.serviceType,
    })

    return NextResponse.json({
      data: {
        assignment: assignment?.designCenterId ? assignment : null,
        eligibleCenters,
        canAutoAdvance: caseRecord.serviceType === 'design_milling',
      },
    })
  } catch (error) {
    console.error('[cases/[id]/design-assign GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffRole(ASSIGN_ROLES)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const caseRecord = await getDesignableCase(id)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Design Only or Design + Milling case not found' }, { status: 404 })
    }

    if (!DESIGN_ASSIGNABLE_STATUSES.includes(caseRecord.status)) {
      return NextResponse.json(
        { error: 'Cannot reassign the design partner after work has started — place the case On Hold first' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { centerId, qcId, autoAdvanceToMilling, notes } = body

    if (!centerId || typeof centerId !== 'string') {
      return NextResponse.json({ error: 'centerId is required' }, { status: 400 })
    }
    if (!qcId || typeof qcId !== 'string') {
      return NextResponse.json({ error: 'A QC lead must be assigned in the same action — a design partner has no way to pick one itself' }, { status: 400 })
    }
    if (autoAdvanceToMilling && caseRecord.serviceType !== 'design_milling') {
      return NextResponse.json({ error: 'Auto-advance to milling only applies to Design + Milling cases' }, { status: 400 })
    }

    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, centerId)).limit(1)
    if (!center || !center.active) {
      return NextResponse.json({ error: 'Milling centre not found or inactive' }, { status: 404 })
    }

    const eligibleCenters = await getEligibleCenters({
      category: caseRecord.category ?? '',
      subTypeData: caseRecord.subTypeData,
      serviceType: caseRecord.serviceType,
    })
    if (!eligibleCenters.some((c) => c.id === centerId)) {
      return NextResponse.json(
        { error: 'This centre has not enabled or priced this restoration under this flow' },
        { status: 400 }
      )
    }

    const [qc] = await db.select().from(profiles).where(eq(profiles.id, qcId)).limit(1)
    if (!qc || qc.role !== 'qc') {
      return NextResponse.json({ error: 'qcId must be an active QC lead' }, { status: 400 })
    }

    await assignDesignCentre({
      caseId: id,
      centerId,
      qcId,
      autoAdvanceToMilling: Boolean(autoAdvanceToMilling),
      actorId: auth.profile.id,
      notes: typeof notes === 'string' ? notes : null,
    })

    await invalidateCasesCache(caseRecord.clientId).catch(() => {})
    await deleteCachedData(`case:detail:${id}`).catch(() => {})

    await logActivity({
      actor: auth.profile,
      action: 'case.design_partner_assigned',
      caseId: id,
      details: {
        millingCenterId: centerId,
        millingCenterName: center.name,
        qcId,
        autoAdvanceToMilling: Boolean(autoAdvanceToMilling),
      },
    }).catch((err) => console.error('[case.design_partner_assigned logActivity]', err))

    const [updatedCase] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
    return NextResponse.json({ data: updatedCase })
  } catch (error) {
    console.error('[cases/[id]/design-assign POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffRole(ASSIGN_ROLES)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const caseRecord = await getDesignableCase(id)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Design Only or Design + Milling case not found' }, { status: 404 })
    }

    if (!DESIGN_ASSIGNABLE_STATUSES.includes(caseRecord.status)) {
      return NextResponse.json(
        { error: 'Cannot withdraw the design partner after work has started — place the case On Hold first' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const { designerId } = body
    if (!designerId || typeof designerId !== 'string') {
      return NextResponse.json({ error: 'designerId is required to reassign the case internally' }, { status: 400 })
    }

    await withdrawDesignCentreToInternal({ caseId: id, designerId, actorId: auth.profile.id })

    await invalidateCasesCache(caseRecord.clientId).catch(() => {})
    await deleteCachedData(`case:detail:${id}`).catch(() => {})

    await logActivity({
      actor: auth.profile,
      action: 'case.design_partner_withdrawn',
      caseId: id,
      details: { designerId },
    }).catch((err) => console.error('[case.design_partner_withdrawn logActivity]', err))

    const [updatedCase] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
    return NextResponse.json({ data: updatedCase })
  } catch (error) {
    console.error('[cases/[id]/design-assign DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
