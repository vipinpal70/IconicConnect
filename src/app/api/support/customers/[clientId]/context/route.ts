import { NextResponse } from 'next/server'
import { z } from 'zod'
import { customerContext } from '@/src/lib/support/agent-tools'
import { errorResponse, parseId, requireSupportActor } from '@/src/lib/support/http'

/** GET: lab details, recent cases, previous conversations and satisfaction (agents only). `?ticket=` excludes the open one. */
export async function GET(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { actor } = await requireSupportActor()
    const clientId = parseId((await params).clientId)
    const ticket = new URL(req.url).searchParams.get('ticket')
    const exclude = ticket && z.uuid().safeParse(ticket).success ? ticket : undefined
    return NextResponse.json(await customerContext(actor, clientId, exclude))
  } catch (error) {
    return errorResponse(error)
  }
}
