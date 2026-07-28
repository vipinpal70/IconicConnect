import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases, caseFiles } from '@/src/db/schema/case'
import { millingCaseAssignments } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'
import { toMillingCaseView } from '@/src/lib/milling/case-view'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params

    const [assignment] = await db
      .select()
      .from(millingCaseAssignments)
      .where(and(eq(millingCaseAssignments.caseId, id), eq(millingCaseAssignments.millingCenterId, auth.millingCenterId)))
      .limit(1)

    if (!assignment) {
      return NextResponse.json({ error: 'Case not found or not assigned to your centre' }, { status: 404 })
    }

    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    const files = await db
      .select({
        id: caseFiles.id,
        fileName: caseFiles.fileName,
        fileUrl: caseFiles.fileUrl,
        fileType: caseFiles.fileType,
        note: caseFiles.note,
        createdAt: caseFiles.createdAt,
      })
      .from(caseFiles)
      .where(eq(caseFiles.caseId, id))

    return NextResponse.json({
      data: {
        ...toMillingCaseView(caseRecord),
        millingStatus: assignment.millingStatus,
        notes: assignment.notes,
        shipToName: assignment.shipToName,
        shipToAddress: assignment.shipToAddress,
        carrier: assignment.carrier,
        trackingNumber: assignment.trackingNumber,
        shipmentEta: assignment.shipmentEta,
        assignedAt: assignment.assignedAt,
        designFileUrl: caseRecord.outputFile,
        files,
        timeline: caseRecord.timeline,
      },
    })
  } catch (error) {
    console.error('[milling/cases/[id] GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
