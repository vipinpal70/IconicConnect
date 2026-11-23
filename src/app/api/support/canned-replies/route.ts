import { NextResponse } from 'next/server'
import { createCannedReply, listCannedReplies } from '@/src/lib/support/agent-tools'
import { errorResponse, parseBody, requireSupportActor } from '@/src/lib/support/http'
import { cannedReplySchema } from '@/src/lib/support/validation'

/** GET: shared replies plus the caller's own (agents only). */
export async function GET() {
  try {
    const { actor } = await requireSupportActor()
    return NextResponse.json(await listCannedReplies(actor))
  } catch (error) {
    return errorResponse(error)
  }
}

/** POST: create a personal reply, or a shared one (admins). */
export async function POST(req: Request) {
  try {
    const { actor } = await requireSupportActor()
    const input = await parseBody(req, cannedReplySchema)
    return NextResponse.json(await createCannedReply(actor, input), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
