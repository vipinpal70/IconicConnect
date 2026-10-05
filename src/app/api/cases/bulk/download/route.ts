import { NextRequest, NextResponse } from 'next/server'
import { authenticate, readRequest, validateCount } from '@/src/lib/bulk-download/access'
import { parseInclude, streamDownload } from '@/src/lib/bulk-download/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Streams a ZIP of the client/lab's uploaded files (optionally + outputs) for the selected cases.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate('internal_files')
    if ('error' in auth) return auth.error
    const { caseIds, fields } = await readRequest(req)
    const bad = validateCount(caseIds)
    if (bad) return bad
    return await streamDownload(req, auth.profile, 'internal_files', caseIds, parseInclude(fields.include))
  } catch (error: unknown) {
    console.error('[bulk download]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
