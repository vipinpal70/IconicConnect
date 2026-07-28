import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCaseAssignments, millingStatusEnum } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'

export async function GET() {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const { millingCenterId } = auth

    const assignments = await db
      .select({
        millingStatus: millingCaseAssignments.millingStatus,
        assignedAt: millingCaseAssignments.assignedAt,
        updatedAt: millingCaseAssignments.updatedAt,
      })
      .from(millingCaseAssignments)
      .where(eq(millingCaseAssignments.millingCenterId, millingCenterId))

    const buckets: Record<string, number> = {}
    for (const status of millingStatusEnum.enumValues) buckets[status] = 0
    for (const a of assignments) buckets[a.millingStatus] = (buckets[a.millingStatus] ?? 0) + 1

    const delivered = assignments.filter((a) => a.millingStatus === 'delivered')
    const avgTatDays = delivered.length
      ? delivered.reduce((sum, a) => sum + (a.updatedAt.getTime() - a.assignedAt.getTime()) / (1000 * 60 * 60 * 24), 0) /
        delivered.length
      : null

    return NextResponse.json({
      data: {
        buckets,
        currentLoad: assignments.length - buckets.delivered,
        avgTatDays: avgTatDays !== null ? parseFloat(avgTatDays.toFixed(1)) : null,
      },
    })
  } catch (error) {
    console.error('[milling/dashboard GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
