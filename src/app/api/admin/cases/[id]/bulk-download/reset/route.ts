import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import { resetCaseDownloads } from '@/src/lib/bulk-download/tracking'
import { logActivity } from '@/src/lib/activity-log'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Admin-only: void a case's bulk-download history so it is offered for download again
 * (support case: "I never received the file"). Body: { scope?: 'client_output' | 'internal_files' | 'both' }.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid case id' }, { status: 400 })

    const body = (await req.json().catch(() => ({}))) as { scope?: unknown }
    const scope = body.scope === 'client_output' || body.scope === 'internal_files' ? body.scope : 'both'

    const result = await resetCaseDownloads(id, scope, auth.profile)
    if (!result) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

    await logActivity({
      actor: auth.profile,
      action: 'case.bulk_download_reset',
      caseId: id,
      details: { scope: 'internal_files', resetScope: scope },
    }).catch((err) => console.error('[bulk_download_reset logActivity]', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin bulk-download reset]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
