import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentSession } from '@/src/lib/auth/server'
import { SESSION_COOKIE } from '@/src/lib/auth/session'
import { liveStreamResponse } from '@/src/lib/live/stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET: the app's live connection (server-sent events), for every signed-in role. See src/lib/live/stream.ts.
 * LIVE_UPDATES=off turns it off: browsers stop reconnecting and use slow polling instead.
 */
export async function GET(req: NextRequest) {
  if (process.env.LIVE_UPDATES === 'off') return new NextResponse(null, { status: 204 })
  const session = await getCurrentSession()
  const sid = req.cookies.get(SESSION_COOKIE)?.value
  if (!session || !sid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return liveStreamResponse(session, sid, req.signal)
}
