import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
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

    const conditions = [eq(millingCaseAssignments.millingCenterId, auth.millingCenterId)]
    if (statusFilter && (millingStatusEnum.enumValues as readonly string[]).includes(statusFilter)) {
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
          millingStatus: a.millingStatus,
          shipToName: a.shipToName,
          shipToAddress: a.shipToAddress,
          carrier: a.carrier,
          trackingNumber: a.trackingNumber,
          shipmentEta: a.shipmentEta,
          assignedAt: a.assignedAt,
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[milling/cases GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
