import { NextResponse } from 'next/server'
import { and, eq, or } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases, caseFiles, casePreviewFiles } from '@/src/db/schema/case'
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

    // A case reaches this centre's portal for either leg (or both, in Flow
    // 3) — case-flow-update-plan.md §5.1/§10. Whichever leg(s) match this
    // centre determine what actions the frontend should offer.
    const [assignment] = await db
      .select()
      .from(millingCaseAssignments)
      .where(
        and(
          eq(millingCaseAssignments.caseId, id),
          or(
            eq(millingCaseAssignments.designCenterId, auth.millingCenterId),
            eq(millingCaseAssignments.productionCenterId, auth.millingCenterId)
          )
        )
      )
      .limit(1)

    if (!assignment) {
      return NextResponse.json({ error: 'Case not found or not assigned to your centre' }, { status: 404 })
    }

    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    const isDesignCentre = assignment.designCenterId === auth.millingCenterId
    const isProductionCentre = assignment.productionCenterId === auth.millingCenterId && assignment.millingStatus !== null

    const [files, previewFiles] = await Promise.all([
      db
        .select({
          id: caseFiles.id,
          fileName: caseFiles.fileName,
          fileUrl: caseFiles.fileUrl,
          fileType: caseFiles.fileType,
          note: caseFiles.note,
          createdAt: caseFiles.createdAt,
        })
        .from(caseFiles)
        .where(eq(caseFiles.caseId, id)),
      db
        .select({
          id: casePreviewFiles.id,
          fileName: casePreviewFiles.fileName,
          fileUrl: casePreviewFiles.fileUrl,
          fileType: casePreviewFiles.fileType,
          createdAt: casePreviewFiles.createdAt,
        })
        .from(casePreviewFiles)
        .where(eq(casePreviewFiles.caseId, id)),
    ])

    return NextResponse.json({
      data: {
        ...toMillingCaseView(caseRecord),
        status: caseRecord.status,
        isDesignCentre,
        isProductionCentre,
        millingStatus: assignment.millingStatus,
        notes: assignment.notes,
        shipToName: assignment.shipToName,
        shipToAddress: assignment.shipToAddress,
        carrier: assignment.carrier,
        trackingNumber: assignment.trackingNumber,
        shipmentEta: assignment.shipmentEta,
        designAssignedAt: assignment.designAssignedAt,
        productionAssignedAt: assignment.productionAssignedAt,
        outputFile: caseRecord.outputFile,
        previewFile: caseRecord.previewFile,
        outputNote: caseRecord.outputNote,
        // Legacy alias kept for any caller still reading the old field name.
        designFileUrl: caseRecord.outputFile,
        files,
        previewFiles,
        timeline: caseRecord.timeline,
      },
    })
  } catch (error) {
    console.error('[milling/cases/[id] GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
