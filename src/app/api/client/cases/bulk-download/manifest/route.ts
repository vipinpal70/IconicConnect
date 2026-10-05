import { NextRequest, NextResponse } from 'next/server'
import { authenticate, readRequest, validateCount } from '@/src/lib/bulk-download/access'
import { buildManifest, DEFAULT_INCLUDE, wantsIncludeDownloaded } from '@/src/lib/bulk-download/service'

export const runtime = 'nodejs'

// Preflight for the client "Download outputs" dialog: file counts, size, skipped reasons.
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate('client_output')
    if ('error' in auth) return auth.error
    const { caseIds, fields } = await readRequest(req)
    const bad = validateCount(caseIds)
    if (bad) return bad
    return NextResponse.json(await buildManifest(auth.profile, 'client_output', caseIds, DEFAULT_INCLUDE, wantsIncludeDownloaded(fields)))
  } catch (error: unknown) {
    console.error('[client bulk-download manifest]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
