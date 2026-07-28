import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { millingCaseAssignments, millingStatusEnum } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'
import { logActivity } from '@/src/lib/activity-log'
import { invalidateCasesCache } from '@/src/lib/redis-cache'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMillingUser(['milling_admin', 'milling_production'])
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const body = await req.json()
    const { status } = body

    if (!(millingStatusEnum.enumValues as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
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
      .set({ millingStatus: status, updatedAt: new Date() })
      .where(eq(millingCaseAssignments.id, assignment.id))
      .returning()

    const [caseRecord] = await db
      .update(cases)
      .set({ status, updatedAt: new Date() })
      .where(eq(cases.id, id))
      .returning()

    await invalidateCasesCache(caseRecord?.clientId).catch(() => {})

    await logActivity({
      actor: auth.profile,
      action: 'case.milling_status_updated',
      caseId: id,
      details: { status, previousStatus: assignment.millingStatus },
    }).catch((err) => console.error('[case.milling_status_updated logActivity]', err))

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[milling/cases/[id]/status PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
