import { NextRequest, NextResponse } from 'next/server'
import { createClient, getCurrentSession } from '@/src/lib/auth/server'
import { logAuthEvent } from '@/src/lib/auth/audit'
import { SESSION_COOKIE } from '@/src/lib/auth/session'

export async function POST(req: NextRequest) {
  const session = await getCurrentSession() // read BEFORE the session is destroyed so the event names the user
  const supabase = await createClient()
  await supabase.auth.signOut()
  if (session) logAuthEvent({ event: 'signout', userId: session.userId, email: session.email, headers: req.headers })
  const res = NextResponse.json({ success: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
