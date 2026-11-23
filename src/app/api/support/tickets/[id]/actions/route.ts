import { NextResponse } from 'next/server'
import { errorResponse, notFound, parseBody, parseId, requireSupportActor } from '@/src/lib/support/http'
import { getTicketDetail } from '@/src/lib/support/queries'
import { applyTicketAction } from '@/src/lib/support/service'
import { actionSchema } from '@/src/lib/support/validation'

/** POST: close, reopen, assign, claim or re-triage. Returns the updated conversation header. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireSupportActor()
    const ticketId = parseId((await params).id)
    const request = await parseBody(req, actionSchema)
    await applyTicketAction(caller, ticketId, request)
    const ticket = await getTicketDetail(caller.actor, ticketId)
    if (!ticket) throw notFound()
    return NextResponse.json(ticket)
  } catch (error) {
    return errorResponse(error)
  }
}
