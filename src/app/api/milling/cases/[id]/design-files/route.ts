import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases, casePreviewFiles } from '@/src/db/schema/case'
import { millingCaseAssignments } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'
import { createClient } from '@/src/lib/supabase/server'
import { logActivity } from '@/src/lib/activity-log'
import { invalidateCasesCache, deleteCachedData } from '@/src/lib/redis-cache'

// A design-partner centre's output/preview file upload — case-flow-update-plan.md
// §6.2. Separate from /api/milling/cases/[id]/files (which is scoped to the
// PRODUCTION leg — manufacturing/QC photos) since this is design-leg-only and
// writes to cases.outputFile/previewFile (or case_preview_files) instead of
// case_files. Reuses the same Supabase-storage upload mechanism the existing
// production files route already uses, rather than the R2 chunked-upload flow
// (/api/cases/upload), which only resolves a clientId for admin/client roles.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMillingUser(['milling_admin', 'milling_production'])
  if ('error' in auth) return auth.error

  try {
    const { id } = await params

    const [assignment] = await db
      .select()
      .from(millingCaseAssignments)
      .where(and(eq(millingCaseAssignments.caseId, id), eq(millingCaseAssignments.designCenterId, auth.millingCenterId)))
      .limit(1)

    if (!assignment) {
      return NextResponse.json({ error: 'Case not found or not assigned to your centre for design' }, { status: 404 })
    }

    const [caseForCache] = await db.select({ clientId: cases.clientId }).from(cases).where(eq(cases.id, id)).limit(1)

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const kind = formData.get('kind') === 'preview' ? 'preview' : 'output'
    const note = typeof formData.get('note') === 'string' ? String(formData.get('note')).trim() : ''

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const supabase = await createClient()
    const fileExt = file.name.split('.').pop()
    const fileName = `${id}/design-${kind}-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

    const { error: uploadError } = await supabase.storage.from('case-files').upload(fileName, file)
    if (uploadError) {
      console.error('Supabase upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload file to storage' }, { status: 500 })
    }

    const { data: publicUrlData } = supabase.storage.from('case-files').getPublicUrl(fileName)
    const fileUrl = publicUrlData.publicUrl

    if (kind === 'output') {
      await db
        .update(cases)
        .set({ outputFile: fileUrl, outputNote: note || null, updatedAt: new Date() })
        .where(eq(cases.id, id))
    } else {
      await db.insert(casePreviewFiles).values({
        caseId: id,
        uploadedBy: auth.profile.id,
        fileName: file.name,
        fileUrl,
        fileType: file.type,
        fileSize: file.size,
      })
    }

    await Promise.all([
      invalidateCasesCache(caseForCache?.clientId).catch(() => {}),
      deleteCachedData(`case:detail:${id}`).catch(() => {}),
    ])

    await logActivity({
      actor: auth.profile,
      action: 'case.design_file_uploaded',
      caseId: id,
      details: { kind, fileName: file.name, note: note || null },
    }).catch((err) => console.error('[case.design_file_uploaded logActivity]', err))

    return NextResponse.json({ data: { fileUrl, kind } }, { status: 201 })
  } catch (error) {
    console.error('[milling/cases/[id]/design-files POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
