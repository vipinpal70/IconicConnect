import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { millingCaseAssignments, millingCenters } from '@/src/db/schema/milling'
import { requireStaffRole } from '@/src/lib/milling/admin-guard'
import { routeCase } from '@/src/lib/milling/routing-engine'
import { getEligibleCenters } from '@/src/lib/milling/eligibility'
import { assignProductionCentre } from '@/src/lib/milling/assignment'
import { resolveCaseSubCategory } from '@/src/lib/pricing'
import { logActivity } from '@/src/lib/activity-log'
import { invalidateCasesCache } from '@/src/lib/redis-cache'

// Admin can assign from anywhere; qc/designer can assign directly from the
// case list once Internal QC is complete — they already own every other
// step of getting a case to this point.
const ASSIGN_ROLES = ['admin', 'qc', 'designer']

// Production statuses common to both milling-involved flows — a case
// already mid-milling can always be re-assigned to a different centre.
const PRODUCTION_STATUSES = new Set([
  'ready_for_milling',
  'milling_in_progress',
  'milling_qc',
  'dispatched',
])

// Statuses from which a case may be (re-)assigned to a milling centre.
// design_milling is assignable right after Internal QC — there is no client
// approval step for this flow; milling_only has no design phase at all, so
// it's assignable right after file verification.
function isAssignableStatus(serviceType: string, status: string): boolean {
  if (PRODUCTION_STATUSES.has(status)) return true
  if (serviceType === 'design_milling') return status === 'internal_qc'
  if (serviceType === 'milling_only') return status === 'scan_verified'
  return false
}

async function getMillableCase(id: string) {
  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
  if (!caseRecord || (caseRecord.serviceType !== 'design_milling' && caseRecord.serviceType !== 'milling_only')) return null
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
    const caseRecord = await getMillableCase(id)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Design + Milling or Milling Only case not found' }, { status: 404 })
    }

    const [assignment] = await db
      .select({
        id: millingCaseAssignments.id,
        designCenterId: millingCaseAssignments.designCenterId,
        productionCenterId: millingCaseAssignments.productionCenterId,
        productionCenterName: millingCenters.name,
        millingStatus: millingCaseAssignments.millingStatus,
        carrier: millingCaseAssignments.carrier,
        trackingNumber: millingCaseAssignments.trackingNumber,
        shipmentEta: millingCaseAssignments.shipmentEta,
        notes: millingCaseAssignments.notes,
        autoAdvanceToMilling: millingCaseAssignments.autoAdvanceToMilling,
        productionAssignedAt: millingCaseAssignments.productionAssignedAt,
      })
      .from(millingCaseAssignments)
      .leftJoin(millingCenters, eq(millingCenters.id, millingCaseAssignments.productionCenterId))
      .where(eq(millingCaseAssignments.caseId, id))
      .limit(1)

    // millingStatus is only ever set once a case has actually entered
    // production — an assignment row can exist with only designCenterId
    // populated (Flow 1, design still in progress) or with
    // productionCenterId pre-committed but millingStatus still null (Flow 3,
    // not yet auto-advanced). Both read as "not in production yet" here.
    if (assignment?.millingStatus) {
      return NextResponse.json({ data: { assignment, recommendation: null, eligibleCenters: [] } })
    }

    const [client] = await db.select().from(profiles).where(eq(profiles.id, caseRecord.clientId)).limit(1)
    const subCategory = caseRecord.category ? resolveCaseSubCategory(caseRecord.category, caseRecord.subTypeData) : null

    const [recommendation, eligibleCenters] = await Promise.all([
      routeCase({
        category: caseRecord.category ?? undefined,
        subCategory: subCategory ?? undefined,
        clientId: caseRecord.clientId,
        state: client?.state ?? undefined,
        country: client?.country ?? undefined,
      }),
      getEligibleCenters({
        category: caseRecord.category ?? '',
        subTypeData: caseRecord.subTypeData,
        serviceType: caseRecord.serviceType,
      }),
    ])

    return NextResponse.json({ data: { assignment: null, recommendation, eligibleCenters } })
  } catch (error) {
    console.error('[cases/[id]/milling-assign GET]', error)
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
    const caseRecord = await getMillableCase(id)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Design + Milling or Milling Only case not found' }, { status: 404 })
    }

    if (!isAssignableStatus(caseRecord.serviceType, caseRecord.status)) {
      const reason = caseRecord.serviceType === 'milling_only'
        ? 'Case must have its file verified before it can be assigned to a milling centre'
        : 'Case must complete Internal QC before it can be assigned to a milling centre'
      return NextResponse.json(
        { error: reason },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { millingCenterId, notes } = body

    if (!millingCenterId || typeof millingCenterId !== 'string') {
      return NextResponse.json({ error: 'millingCenterId is required' }, { status: 400 })
    }

    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, millingCenterId)).limit(1)
    if (!center || !center.active) {
      return NextResponse.json({ error: 'Milling centre not found or inactive' }, { status: 404 })
    }

    const eligibleCenters = await getEligibleCenters({
      category: caseRecord.category ?? '',
      subTypeData: caseRecord.subTypeData,
      serviceType: caseRecord.serviceType,
    })
    if (!eligibleCenters.some((c) => c.id === millingCenterId)) {
      return NextResponse.json(
        { error: 'This centre has not enabled or priced this restoration under this flow' },
        { status: 400 }
      )
    }

    await assignProductionCentre({
      caseId: id,
      centerId: millingCenterId,
      actorId: auth.profile.id,
      notes: typeof notes === 'string' ? notes : null,
    })

    await invalidateCasesCache(caseRecord.clientId).catch(() => {})

    await logActivity({
      actor: auth.profile,
      action: 'case.milling_assigned',
      caseId: id,
      details: {
        millingCenterId,
        millingCenterName: center.name,
      },
    }).catch((err) => console.error('[case.milling_assigned logActivity]', err))

    const [assignment] = await db
      .select()
      .from(millingCaseAssignments)
      .where(eq(millingCaseAssignments.caseId, id))
      .limit(1)

    return NextResponse.json({ data: assignment })
  } catch (error) {
    console.error('[cases/[id]/milling-assign POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
