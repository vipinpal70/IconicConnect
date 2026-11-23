import { NextResponse } from 'next/server'
import { attachmentUrl } from '@/src/lib/support/attachments'
import { errorResponse, parseId, requireSupportActor } from '@/src/lib/support/http'

/**
 * GET: view (`inline`) or download (`?download=1`) an attachment. Checks access, then redirects to a
 * 15-minute signed R2 URL. Videos stream with HTTP Range requests from there. 410 = removed by the
 * 3-month storage retention.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireSupportActor()
    const attachmentId = parseId((await params).id)
    const download = new URL(req.url).searchParams.get('download') === '1'
    const url = await attachmentUrl(actor, attachmentId, download)
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
