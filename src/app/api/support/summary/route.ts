import { NextResponse } from 'next/server'
import { errorResponse, requireSupportActor } from '@/src/lib/support/http'
import { getSummary } from '@/src/lib/support/queries'

/** GET: unread / new / mine counts for badges. */
export async function GET() {
  try {
    const { actor } = await requireSupportActor()
    return NextResponse.json(await getSummary(actor))
  } catch (error) {
    return errorResponse(error)
  }
}
