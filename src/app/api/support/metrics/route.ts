import { NextResponse } from 'next/server'
import { supportMetrics } from '@/src/lib/support/agent-tools'
import { errorResponse, parseQuery, requireSupportActor } from '@/src/lib/support/http'
import { metricsQuerySchema } from '@/src/lib/support/validation'

/** GET ?days=7|30|90: team numbers for the inbox header (agents only). */
export async function GET(req: Request) {
  try {
    const { actor } = await requireSupportActor()
    const { days } = parseQuery(req, metricsQuerySchema)
    return NextResponse.json(await supportMetrics(actor, days), { headers: { 'Cache-Control': 'private, max-age=60' } })
  } catch (error) {
    return errorResponse(error)
  }
}
