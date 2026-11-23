import { NextResponse } from 'next/server'
import { deleteCannedReply, updateCannedReply } from '@/src/lib/support/agent-tools'
import { errorResponse, parseBody, parseId, requireSupportActor } from '@/src/lib/support/http'
import { cannedReplyUpdateSchema } from '@/src/lib/support/validation'

/** PATCH: edit your own reply (admins: shared ones too). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireSupportActor()
    const id = parseId((await params).id)
    const input = await parseBody(req, cannedReplyUpdateSchema)
    return NextResponse.json(await updateCannedReply(actor, id, input))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireSupportActor()
    const id = parseId((await params).id)
    await deleteCannedReply(actor, id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
