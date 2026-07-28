import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCaseAssignments } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'
import { logActivity } from '@/src/lib/activity-log'

const CARRIERS = ['UPS', 'FedEx', 'DHL'] as const

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMillingUser(['milling_admin', 'milling_production'])
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const body = await req.json()
    const { carrier, trackingNumber, shipmentEta } = body

    if (!CARRIERS.includes(carrier)) {
      return NextResponse.json({ error: 'Invalid carrier' }, { status: 400 })
    }
    if (!trackingNumber || typeof trackingNumber !== 'string') {
      return NextResponse.json({ error: 'trackingNumber is required' }, { status: 400 })
    }

    const [assignment] = await db
      .select()
      .from(millingCaseAssignments)
      .where(and(eq(millingCaseAssignments.caseId, id), eq(millingCaseAssignments.millingCenterId, auth.millingCenterId)))
      .limit(1)

    if (!assignment) {
      return NextResponse.json({ error: 'Case not found or not assigned to your centre' }, { status: 404 })
    }

    const [updated] = await db
      .update(millingCaseAssignments)
      .set({
        carrier,
        trackingNumber,
        shipmentEta: shipmentEta || null,
        updatedAt: new Date(),
      })
      .where(eq(millingCaseAssignments.id, assignment.id))
      .returning()

    await logActivity({
      actor: auth.profile,
      action: 'case.milling_shipment_recorded',
      caseId: id,
      details: { carrier, trackingNumber, shipmentEta: shipmentEta || null },
    }).catch((err) => console.error('[case.milling_shipment_recorded logActivity]', err))

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[milling/cases/[id]/shipment POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
