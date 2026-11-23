import { NextResponse } from 'next/server'
import { errorResponse, notFound, parseId, requireSupportActor } from '@/src/lib/support/http'
import { getTicketDetail } from '@/src/lib/support/queries'

/** GET: conversation header, the caller's allowed actions and the other side's read position. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireSupportActor()
    const ticketId = parseId((await params).id)
    const ticket = await getTicketDetail(actor, ticketId)
    if (!ticket) throw notFound()
    return NextResponse.json(ticket)
  } catch (error) {
    return errorResponse(error)
  }
}
