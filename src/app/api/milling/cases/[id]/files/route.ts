import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { caseFiles } from '@/src/db/schema/case'
import { millingCaseAssignments } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'
import { createClient } from '@/src/lib/supabase/server'
import { logActivity } from '@/src/lib/activity-log'

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
      .where(and(eq(millingCaseAssignments.caseId, id), eq(millingCaseAssignments.millingCenterId, auth.millingCenterId)))
      .limit(1)

    if (!assignment) {
      return NextResponse.json({ error: 'Case not found or not assigned to your centre' }, { status: 404 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const note = typeof formData.get('note') === 'string' ? String(formData.get('note')).trim() : ''

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const supabase = await createClient()
    const fileExt = file.name.split('.').pop()
    const fileName = `${id}/milling-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

    const { error: uploadError } = await supabase.storage.from('case-files').upload(fileName, file)
    if (uploadError) {
      console.error('Supabase upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload file to storage' }, { status: 500 })
    }

    const { data: publicUrlData } = supabase.storage.from('case-files').getPublicUrl(fileName)

    const [insertedFile] = await db
      .insert(caseFiles)
      .values({
        caseId: id,
        uploadedBy: auth.profile.id,
        fileName: file.name,
        fileUrl: publicUrlData.publicUrl,
        note: note ? `Milling upload: ${note}` : 'Milling upload',
        fileType: file.type,
        fileSize: file.size,
      })
      .returning()

    await logActivity({
      actor: auth.profile,
      action: 'case.milling_file_uploaded',
      caseId: id,
      details: { fileName: file.name, note: note || null },
    }).catch((err) => console.error('[case.milling_file_uploaded logActivity]', err))

    return NextResponse.json({ data: insertedFile }, { status: 201 })
  } catch (error) {
    console.error('[milling/cases/[id]/files POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
