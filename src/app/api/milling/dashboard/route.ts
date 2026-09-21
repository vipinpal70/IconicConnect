import { NextResponse } from 'next/server'
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCaseAssignments, millingStatusEnum } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'

export async function GET() {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const { millingCenterId } = auth

    const [productionAssignments, designAssignments] = await Promise.all([
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

    return NextResponse.json({
      data: {
        buckets,
        currentLoad: productionAssignments.length - buckets.delivered,
        designQueueCount: designAssignments.length,
        avgTatDays: avgTatDays !== null ? parseFloat(avgTatDays.toFixed(1)) : null,
      },
    })
  } catch (error) {
    console.error('[milling/dashboard GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
