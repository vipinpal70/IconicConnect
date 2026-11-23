import { NextResponse } from 'next/server'
import { errorResponse, parseBody, parseId, requireSupportActor } from '@/src/lib/support/http'
import { rateTicket } from '@/src/lib/support/service'
import { rateSchema } from '@/src/lib/support/validation'

/** POST: the lab rates a closed conversation, once (1–5 and an optional comment). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireSupportActor()
    const ticketId = parseId((await params).id)
    const input = await parseBody(req, rateSchema)
    await rateTicket(caller, ticketId, input)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
