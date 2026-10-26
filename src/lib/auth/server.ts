import { cookies } from 'next/headers'
import { getRequestUser } from './request-user'
import { destroySession, SESSION_COOKIE } from './session'

export async function createAuthServerClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: await getRequestUser() },
        error: null,
      }),
      getSession: async () => {
        const user = await getRequestUser()
        return {
          data: { session: user ? { user } : null },
          error: null,
        }
      },
      signOut: async () => {
        const cookieStore = await cookies()
        await destroySession(cookieStore.get(SESSION_COOKIE)?.value)
        cookieStore.delete(SESSION_COOKIE)
        return { error: null }
      },
    },
  }
}
