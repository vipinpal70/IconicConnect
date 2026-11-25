import { NextResponse } from 'next/server'
import { getCurrentSession } from '@/src/lib/auth/server'
import { markPresent } from '@/src/lib/live/presence'
import { isAgentRole } from '@/src/lib/support/constants'

/** POST: a tab of this person is visible (sent when one is shown, and every few minutes while it stays so). */
export async function POST() {
  const session = await getCurrentSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await markPresent(session.userId, isAgentRole(session.role))
  return new NextResponse(null, { status: 204 })
}
