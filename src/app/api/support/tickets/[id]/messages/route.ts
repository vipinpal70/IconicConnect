import { NextResponse } from 'next/server'
import { enforceLimit, errorResponse, notFound, parseBody, parseId, parseQuery, requireSupportActor } from '@/src/lib/support/http'
import { isTicketVisible, listMessages } from '@/src/lib/support/queries'
import { postMessage } from '@/src/lib/support/service'
import { listMessagesQuerySchema, postMessageSchema } from '@/src/lib/support/validation'

/** GET: a page of the thread (`after` for new messages, `before` for older history). Notes are agent-only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireSupportActor()
    const ticketId = parseId((await params).id)
    const query = parseQuery(req, listMessagesQuerySchema)
    // Visibility is decided by the same rule as the ticket itself
    if (!(await isTicketVisible(actor, ticketId))) throw notFound()
    return NextResponse.json(await listMessages(actor, ticketId, query))
  } catch (error) {
    return errorResponse(error)
  }
}

/** POST: send a message (`visibility: note` = internal, agents only). Idempotent through `clientMsgId`. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireSupportActor()
    const ticketId = parseId((await params).id)
    const input = await parseBody(req, postMessageSchema)
    await enforceLimit(caller.actor.id, 'message')
    const result = await postMessage(caller, ticketId, input)
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return errorResponse(error)
  }
}
