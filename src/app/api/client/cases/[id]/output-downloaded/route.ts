import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/src/lib/bulk-download/access'
import { recordSingleOutputDownload } from '@/src/lib/bulk-download/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A lab (client or its sub-user) downloaded this case's final design file
// from the case page — mark the case as downloaded by the lab.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate('client_output')
    if ('error' in auth) return auth.error
    const { id } = await params
    const result = await recordSingleOutputDownload(auth.profile, id)
    return NextResponse.json({ data: result })
  } catch (error: unknown) {
    console.error('[client output-downloaded]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
