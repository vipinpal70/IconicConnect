import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentSession } from '@/src/lib/auth/server'
import { isCustomerRole } from '@/src/lib/support/constants'
import { SESSION_COOKIE } from '@/src/lib/auth/session'
import { liveStreamResponse } from '@/src/lib/live/stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET: the app's live connection (server-sent events), for every signed-in role. See src/lib/live/stream.ts.
 * LIVE_UPDATES turns it off, for everyone or for labs: browsers then stop reconnecting and use slow polling.
 *   off    nobody
 *   staff  staff only (for rolling it out: staff first, then labs)
 *   unset  everyone
 */
export async function GET(req: NextRequest) {
  const mode = process.env.LIVE_UPDATES
  if (mode === 'off') return new NextResponse(null, { status: 204 })
  const session = await getCurrentSession()
  const sid = req.cookies.get(SESSION_COOKIE)?.value
  if (!session || !sid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mode === 'staff' && isCustomerRole(session.role)) return new NextResponse(null, { status: 204 })
  return liveStreamResponse(session, sid, req.signal)
}
