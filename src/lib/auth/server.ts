import { cookies } from 'next/headers'
import { cache } from 'react'
import { SESSION_COOKIE, getSession, destroySession, type SessionData } from './session'

/** Session for the current request — one Redis GET, deduped per request by React cache(). */
export const getCurrentSession = cache(async (): Promise<SessionData | null> => {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value
  return getSession(sid)
})

export type AuthUser = { id: string; email: string; role: string; clientId: string | null }

/**
 * Drop-in for the old `createClient()` from supabase/server: the ~100 route handlers keep calling
 * `supabase.auth.getUser()` unchanged, but it now resolves from the Redis session (no network hop).
 */
export async function createClient() {
  return {
    auth: {
      async getUser(): Promise<
        { data: { user: AuthUser }; error: null } | { data: { user: null }; error: { message: string } }
      > {
        const s = await getCurrentSession()
        if (!s) return { data: { user: null }, error: { message: 'Unauthorized' } }
        return { data: { user: { id: s.userId, email: s.email, role: s.role, clientId: s.clientId } }, error: null }
      },
      async signOut() {
        const store = await cookies()
        const sid = store.get(SESSION_COOKIE)?.value
        const s = await getSession(sid)
        await destroySession(sid, s?.userId)
        store.delete(SESSION_COOKIE)
        return { error: null }
      },
    },
  }
}
