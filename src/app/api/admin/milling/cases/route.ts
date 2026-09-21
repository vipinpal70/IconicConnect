import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { millingCaseAssignments, millingCenters } from '@/src/db/schema/milling'
import { eq, desc } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { requireAdmin } from '@/src/lib/milling/admin-guard'

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const designCenters = alias(millingCenters, 'design_centers')

    const rows = await db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        category: cases.category,
        status: cases.status,
        dueDate: cases.dueDate,
        createdAt: cases.createdAt,
        clientId: cases.clientId,
        clientName: profiles.fullName,
        clientLabName: profiles.labName,
        designSource: cases.designSource,
        assignmentId: millingCaseAssignments.id,
        millingStatus: millingCaseAssignments.millingStatus,
        designCenterId: millingCaseAssignments.designCenterId,
        designCenterName: designCenters.name,
        productionCenterId: millingCaseAssignments.productionCenterId,
        millingCenterName: millingCenters.name,
        autoAdvanceToMilling: millingCaseAssignments.autoAdvanceToMilling,
        carrier: millingCaseAssignments.carrier,
        trackingNumber: millingCaseAssignments.trackingNumber,
        assignedAt: millingCaseAssignments.productionAssignedAt,
      })
      .from(cases)
      .leftJoin(profiles, eq(cases.clientId, profiles.id))
      .leftJoin(millingCaseAssignments, eq(millingCaseAssignments.caseId, cases.id))
      .leftJoin(millingCenters, eq(millingCenters.id, millingCaseAssignments.productionCenterId))
      .leftJoin(designCenters, eq(designCenters.id, millingCaseAssignments.designCenterId))
      .where(eq(cases.serviceType, 'design_milling'))
      .orderBy(desc(cases.createdAt))

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[admin/milling/cases GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
