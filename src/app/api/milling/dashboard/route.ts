import { NextResponse } from 'next/server'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { millingCaseAssignments, millingServiceCatalog, millingStatusEnum } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'
import { toMillingCaseView } from '@/src/lib/milling/case-view'
import { resolveCaseSubCategory } from '@/src/lib/pricing'

// Design-leg statuses still actionable by the centre (not yet submitted to
// QC) and production-leg statuses still actionable (not yet dispatched) —
// milling-portal-plan.md §4 #1. Matches case-flow-update-plan.md §6.2's
// design-actionable set plus the pre-dispatch production statuses.
const DESIGN_ACTIONABLE_STATUSES = new Set(['allocated_to_designer', 'in_progress', 'client_feedback'])
const PRODUCTION_ACTIONABLE_STATUSES = new Set(['ready_for_milling', 'milling_in_progress', 'milling_qc'])
const DUE_SOON_LIMIT = 5

export async function GET() {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const { millingCenterId } = auth

    const [productionAssignments, designAssignments, ownAssignments, catalogWithCap] = await Promise.all([
      db
        .select({
          millingStatus: millingCaseAssignments.millingStatus,
          productionAssignedAt: millingCaseAssignments.productionAssignedAt,
          updatedAt: millingCaseAssignments.updatedAt,
        })
        .from(millingCaseAssignments)
        .where(and(eq(millingCaseAssignments.productionCenterId, millingCenterId), isNotNull(millingCaseAssignments.millingStatus))),
      db
        .select({ id: millingCaseAssignments.id })
        .from(millingCaseAssignments)
        .where(eq(millingCaseAssignments.designCenterId, millingCenterId)),
      // Every assignment (design and/or production leg) touching this
      // centre, joined with its case — powers both dueSoon and capacity below.
      db
        .select({
          caseId: cases.id,
          caseNumber: cases.caseNumber,
          category: cases.category,
          subTypeData: cases.subTypeData,
          serviceType: cases.serviceType,
          status: cases.status,
          dueDate: cases.dueDate,
          designCenterId: millingCaseAssignments.designCenterId,
          productionCenterId: millingCaseAssignments.productionCenterId,
          millingStatus: millingCaseAssignments.millingStatus,
          designAssignedAt: millingCaseAssignments.designAssignedAt,
          productionAssignedAt: millingCaseAssignments.productionAssignedAt,
        })
        .from(millingCaseAssignments)
        .innerJoin(cases, eq(cases.id, millingCaseAssignments.caseId))
        .where(
          or(
            eq(millingCaseAssignments.designCenterId, millingCenterId),
            eq(millingCaseAssignments.productionCenterId, millingCenterId)
          )
        ),
      db
        .select()
        .from(millingServiceCatalog)
        .where(and(eq(millingServiceCatalog.millingCenterId, millingCenterId), isNotNull(millingServiceCatalog.monthlyCapacity))),
    ])

    const buckets: Record<string, number> = {}
    for (const status of millingStatusEnum.enumValues) buckets[status] = 0
    for (const a of productionAssignments) {
      if (!a.millingStatus) continue
      buckets[a.millingStatus] = (buckets[a.millingStatus] ?? 0) + 1
    }

    const delivered = productionAssignments.filter((a) => a.millingStatus === 'delivered' && a.productionAssignedAt)
    const avgTatDays = delivered.length
      ? delivered.reduce(
          (sum, a) => sum + (a.updatedAt.getTime() - a.productionAssignedAt!.getTime()) / (1000 * 60 * 60 * 24),
          0
        ) / delivered.length
      : null

    // Due-soon strip — one row per actionable leg, oldest due date first.
    // A Flow-3 case with both legs still actionable would be rare (design not
    // yet submitted and already in production is contradictory), so no
    // dedup logic is needed beyond "one row per leg that's actually actionable."
    const dueSoon: Array<ReturnType<typeof toMillingCaseView> & { queue: 'design' | 'production'; status: string; overdue: boolean }> = []
    const now = new Date()
    for (const row of ownAssignments) {
      const isActionableDesign = row.designCenterId === millingCenterId && DESIGN_ACTIONABLE_STATUSES.has(row.status)
      const isActionableProduction =
        row.productionCenterId === millingCenterId && row.millingStatus && PRODUCTION_ACTIONABLE_STATUSES.has(row.millingStatus)
      const view = toMillingCaseView({
        id: row.caseId,
        caseNumber: row.caseNumber,
        category: row.category,
        subTypeData: row.subTypeData,
        dueDate: row.dueDate,
      })
      const overdue = Boolean(row.dueDate && row.dueDate < now)
      if (isActionableDesign) {
        dueSoon.push({ ...view, queue: 'design', status: row.status, overdue })
      }
      if (isActionableProduction) {
        dueSoon.push({ ...view, queue: 'production', status: row.status, overdue })
      }
    }
    dueSoon.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    })

    // Capacity-at-a-glance — visibility only, never a block (matches the
    // "no hard capacity gate anywhere" behavior already noted in
    // routing-engine.ts). Counts, per catalog line with a cap set, how many
    // of this centre's own cases (either leg, matching that line's flow)
    // were assigned to it this calendar month.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const capacity = catalogWithCap.map((row) => {
      const used = ownAssignments.filter((a) => {
        if (a.serviceType !== row.serviceType || a.category !== row.category) return false
        if (resolveCaseSubCategory(a.category ?? '', a.subTypeData) !== row.subCategory) return false
        const assignedAt =
          a.designCenterId === millingCenterId ? a.designAssignedAt : a.productionCenterId === millingCenterId ? a.productionAssignedAt : null
        return Boolean(assignedAt && assignedAt >= monthStart)
      }).length
      return {
        category: row.category,
        subCategory: row.subCategory,
        used,
        cap: row.monthlyCapacity as number,
      }
    })

    return NextResponse.json({
      data: {
        buckets,
        currentLoad: productionAssignments.length - buckets.delivered,
        designQueueCount: designAssignments.length,
        avgTatDays: avgTatDays !== null ? parseFloat(avgTatDays.toFixed(1)) : null,
        dueSoon: dueSoon.slice(0, DUE_SOON_LIMIT),
        capacity,
      },
    })
  } catch (error) {
    console.error('[milling/dashboard GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
