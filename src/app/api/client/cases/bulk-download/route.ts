import { NextRequest, NextResponse } from 'next/server'
import { authenticate, readRequest, validateCount } from '@/src/lib/bulk-download/access'
import { DEFAULT_INCLUDE, streamDownload } from '@/src/lib/bulk-download/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Streams a ZIP of design output + preview files for the selected cases (client / subuser).
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate('client_output')
    if ('error' in auth) return auth.error
    const { caseIds } = await readRequest(req)
    const bad = validateCount(caseIds)
    if (bad) return bad
    return await streamDownload(req, auth.profile, 'client_output', caseIds, DEFAULT_INCLUDE)
  } catch (error: unknown) {
    console.error('[client bulk-download]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
