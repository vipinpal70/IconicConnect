import { NextRequest, NextResponse } from 'next/server'
import { authenticate, readRequest, validateCount } from '@/src/lib/bulk-download/access'
import { buildManifest, parseInclude } from '@/src/lib/bulk-download/service'

export const runtime = 'nodejs'

// Preflight for the internal "Download case files" dialog.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate('internal_files')
    if ('error' in auth) return auth.error
    const { caseIds, fields } = await readRequest(req)
    const bad = validateCount(caseIds)
    if (bad) return bad
    return NextResponse.json(
      await buildManifest(auth.profile, 'internal_files', caseIds, parseInclude(fields.include)),
    )
  } catch (error: unknown) {
    console.error('[bulk download manifest]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
