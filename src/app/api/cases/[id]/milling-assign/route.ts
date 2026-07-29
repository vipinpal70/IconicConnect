import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { millingCaseAssignments, millingCenters } from '@/src/db/schema/milling'
import { requireStaffRole } from '@/src/lib/milling/admin-guard'
import { routeCase } from '@/src/lib/milling/routing-engine'
import { resolveCaseSubCategory } from '@/src/lib/pricing'
import { logActivity } from '@/src/lib/activity-log'
import { invalidateCasesCache } from '@/src/lib/redis-cache'

// Admin can assign from anywhere; qc/designer can assign directly from the
// case list once a design is approved — they already own every other step
// of getting a case to this point.
const ASSIGN_ROLES = ['admin', 'qc', 'designer']

// Statuses from which a case may be (re-)assigned to a milling centre —
// design must be client-approved first, or the case is already mid-milling.
const ASSIGNABLE_STATUSES = new Set([
  'approved',
  'ready_for_milling',
  'milling_in_progress',
  'milling_qc',
  'packaging',
  'dispatched',
])

async function getDesignMillingCase(id: string) {
  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
  if (!caseRecord || caseRecord.serviceType !== 'design_milling') return null
  return caseRecord
}

function buildShipTo(client: typeof profiles.$inferSelect) {
  const shipToName = client.labName || client.fullName || null
  const shipToAddress = [client.city, client.state, client.postalCode, client.country]
    .filter(Boolean)
    .join(', ') || null
  return { shipToName, shipToAddress }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffRole(ASSIGN_ROLES)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const caseRecord = await getDesignMillingCase(id)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Design + Milling case not found' }, { status: 404 })
    }

    const [assignment] = await db
      .select({
        id: millingCaseAssignments.id,
        millingCenterId: millingCaseAssignments.millingCenterId,
        millingCenterName: millingCenters.name,
        millingStatus: millingCaseAssignments.millingStatus,
        carrier: millingCaseAssignments.carrier,
        trackingNumber: millingCaseAssignments.trackingNumber,
        shipmentEta: millingCaseAssignments.shipmentEta,
        notes: millingCaseAssignments.notes,
        assignedAt: millingCaseAssignments.assignedAt,
      })
      .from(millingCaseAssignments)
      .leftJoin(millingCenters, eq(millingCenters.id, millingCaseAssignments.millingCenterId))
      .where(eq(millingCaseAssignments.caseId, id))
      .limit(1)

    if (assignment) {
      return NextResponse.json({ data: { assignment, recommendation: null } })
    }

    const [client] = await db.select().from(profiles).where(eq(profiles.id, caseRecord.clientId)).limit(1)
    const subCategory = caseRecord.category ? resolveCaseSubCategory(caseRecord.category, caseRecord.subTypeData) : null

    const recommendation = await routeCase({
      category: caseRecord.category ?? undefined,
      subCategory: subCategory ?? undefined,
      clientId: caseRecord.clientId,
      state: client?.state ?? undefined,
      country: client?.country ?? undefined,
    })

    return NextResponse.json({ data: { assignment: null, recommendation } })
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
    const caseRecord = await getDesignMillingCase(id)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Design + Milling case not found' }, { status: 404 })
    }

    if (!ASSIGNABLE_STATUSES.has(caseRecord.status)) {
      return NextResponse.json(
        { error: 'Case must be client-approved before it can be assigned to a milling centre' },
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

    const [client] = await db.select().from(profiles).where(eq(profiles.id, caseRecord.clientId)).limit(1)
    if (!client) {
      return NextResponse.json({ error: 'Client profile not found' }, { status: 404 })
    }

    const [existing] = await db
      .select()
      .from(millingCaseAssignments)
      .where(eq(millingCaseAssignments.caseId, id))
      .limit(1)

    const { shipToName, shipToAddress } = buildShipTo(client)

    const [assignment] = await db
      .insert(millingCaseAssignments)
      .values({
        caseId: id,
        millingCenterId,
        millingStatus: 'ready_for_milling',
        notes: notes || null,
        shipToName,
        shipToAddress,
        assignedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: millingCaseAssignments.caseId,
        set: {
          millingCenterId,
          millingStatus: 'ready_for_milling',
          notes: notes || null,
          shipToName,
          shipToAddress,
          assignedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning()

    await db
      .update(cases)
      .set({ status: 'ready_for_milling', updatedAt: new Date() })
      .where(eq(cases.id, id))

    await invalidateCasesCache(caseRecord.clientId).catch(() => {})

    await logActivity({
      actor: auth.profile,
      action: 'case.milling_assigned',
      caseId: id,
      details: {
        millingCenterId,
        millingCenterName: center.name,
        previousCenterId: existing?.millingCenterId ?? null,
      },
    }).catch((err) => console.error('[case.milling_assigned logActivity]', err))

    return NextResponse.json({ data: assignment })
  } catch (error) {
    console.error('[cases/[id]/milling-assign POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
