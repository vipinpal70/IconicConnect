import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { millingCaseAssignments, millingCenters } from '@/src/db/schema/milling'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import { getUnitPrice } from '@/src/lib/invoice'
import { resolveCaseSubCategory } from '@/src/lib/pricing'

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const centers = await db.select().from(millingCenters)

    const assignments = await db
      .select({
        millingCenterId: millingCaseAssignments.millingCenterId,
        millingStatus: millingCaseAssignments.millingStatus,
        assignedAt: millingCaseAssignments.assignedAt,
        updatedAt: millingCaseAssignments.updatedAt,
        caseId: cases.id,
        clientId: cases.clientId,
        category: cases.category,
        subTypeData: cases.subTypeData,
      })
      .from(millingCaseAssignments)
      .innerJoin(cases, eq(cases.id, millingCaseAssignments.caseId))

    const perCenter = await Promise.all(
      centers.map(async (center) => {
        const centerAssignments = assignments.filter((a) => a.millingCenterId === center.id)

        let customerRevenue = 0
        for (const a of centerAssignments) {
          if (!a.category) continue
          const subCategory = resolveCaseSubCategory(a.category, a.subTypeData)
          if (!subCategory) continue
          customerRevenue += await getUnitPrice(a.clientId, a.category, subCategory, 'design_milling')
        }

        const delivered = centerAssignments.filter((a) => a.millingStatus === 'delivered')
        const avgTatDays = delivered.length
          ? delivered.reduce((sum, a) => {
              const days = (a.updatedAt.getTime() - a.assignedAt.getTime()) / (1000 * 60 * 60 * 24)
              return sum + days
            }, 0) / delivered.length
          : null

        return {
          centerId: center.id,
          centerName: center.name,
          active: center.active,
          caseCount: centerAssignments.length,
          activeCaseCount: centerAssignments.filter((a) => a.millingStatus !== 'delivered').length,
          customerRevenue: parseFloat(customerRevenue.toFixed(2)),
          avgTatDays: avgTatDays !== null ? parseFloat(avgTatDays.toFixed(1)) : null,
          // No remake-tracking field exists on cases/milling_case_assignments yet.
          remakeRate: null as number | null,
        }
      })
    )

    return NextResponse.json({ data: perCenter })
  } catch (error) {
    console.error('[admin/milling/analytics GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}