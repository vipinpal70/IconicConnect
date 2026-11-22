import { NextResponse } from 'next/server'
import { enforceLimit, errorResponse, parseBody, parseQuery, requireSupportActor } from '@/src/lib/support/http'
import { listTickets } from '@/src/lib/support/queries'
import { createTicket } from '@/src/lib/support/service'
import { createTicketSchema, listTicketsQuerySchema } from '@/src/lib/support/validation'

/** GET: conversations visible to the caller (customers: their lab; agents: inbox views). */
export async function GET(req: Request) {
  try {
    const { actor } = await requireSupportActor()
    const query = parseQuery(req, listTicketsQuerySchema)
    return NextResponse.json(await listTickets(actor, query))
  } catch (error) {
    return errorResponse(error)
  }
}

/** POST: start a conversation with its first message. Idempotent through `clientMsgId`. */
export async function POST(req: Request) {
  try {
    const caller = await requireSupportActor()
    const input = await parseBody(req, createTicketSchema)
    await enforceLimit(caller.actor.id, 'createTicket')
    const result = await createTicket(caller, input)
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return errorResponse(error)
  }
}
