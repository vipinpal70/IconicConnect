import { NextResponse } from 'next/server'
import { errorResponse, parseBody, parseId, requireSupportActor } from '@/src/lib/support/http'
import { markRead } from '@/src/lib/support/service'
import { markReadSchema } from '@/src/lib/support/validation'

/** POST: the caller has read the thread up to `seq` (never moves backwards). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireSupportActor()
    const ticketId = parseId((await params).id)
    const { seq } = await parseBody(req, markReadSchema)
    await markRead(caller, ticketId, seq)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
