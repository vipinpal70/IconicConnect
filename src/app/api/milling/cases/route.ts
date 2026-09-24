import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { millingCaseAssignments, millingStatusEnum } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'
import { toMillingCaseView } from '@/src/lib/milling/case-view'

export async function GET(req: NextRequest) {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const { searchParams } = new URL(req.url)
    const statusFilter = searchParams.get('status')
    const categoryFilter = searchParams.get('category')
    // 'design' = this centre's Design Queue (case-flow-update-plan.md §7.2/§7.3
    // — assigned as designCenterId, any case status). Default/'production' =
    // today's manufacturing queue (productionCenterId, and only once it has
    // actually entered production — millingStatus is null while a Flow-3
    // commitment hasn't auto-advanced yet).
    const queue = searchParams.get('queue') === 'design' ? 'design' : 'production'

    const conditions =
      queue === 'design'
        ? [eq(millingCaseAssignments.designCenterId, auth.millingCenterId)]
        : [eq(millingCaseAssignments.productionCenterId, auth.millingCenterId), isNotNull(millingCaseAssignments.millingStatus)]

    if (queue === 'production' && statusFilter && (millingStatusEnum.enumValues as readonly string[]).includes(statusFilter)) {
      conditions.push(eq(millingCaseAssignments.millingStatus, statusFilter as (typeof millingStatusEnum.enumValues)[number]))
    }

    const assignments = await db
      .select()
      .from(millingCaseAssignments)
      .where(and(...conditions))

    if (!assignments.length) {
      return NextResponse.json({ data: [] })
    }

    const caseRows = await db
      .select()
      .from(cases)
      .where(inArray(cases.id, assignments.map((a) => a.caseId)))

    const caseById = new Map(caseRows.map((c) => [c.id, c]))

    const data = assignments
      .map((a) => {
        const caseRecord = caseById.get(a.caseId)
        if (!caseRecord) return null
        return {
          ...toMillingCaseView(caseRecord),
          status: caseRecord.status,
          queue,
          millingStatus: a.millingStatus,
          // Flow 3 commitment (case-flow-update-plan.md §7.3) — only
          // meaningful on the Design Queue tab, where it tells the centre
          // this case will auto-continue to them for production once QC
          // approves, with no separate assignment step.
          committedToProduction: a.autoAdvanceToMilling,
          shipToName: a.shipToName,
          shipToAddress: a.shipToAddress,
          carrier: a.carrier,
          trackingNumber: a.trackingNumber,
          shipmentEta: a.shipmentEta,
          assignedAt: queue === 'design' ? a.designAssignedAt : a.productionAssignedAt,
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => !categoryFilter || row.category === categoryFilter)

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[milling/cases GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
