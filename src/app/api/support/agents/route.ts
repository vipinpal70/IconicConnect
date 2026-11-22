import { NextResponse } from 'next/server'
import { SupportError, errorResponse, requireSupportActor } from '@/src/lib/support/http'
import { isAgent } from '@/src/lib/support/policy'
import { listAgents } from '@/src/lib/support/queries'

/** GET: active support agents (agents only), for the assignment menu. */
export async function GET() {
  try {
    const { actor } = await requireSupportActor()
    if (!isAgent(actor)) throw new SupportError(403, 'forbidden', 'Only the support team can see this')
    return NextResponse.json(await listAgents())
  } catch (error) {
    return errorResponse(error)
  }
}
