import { cookies, headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { authCredentials } from '@/src/db/schema/auth-credentials'
import { SESSION_COOKIE, getSession } from './session'
import type { AuthUser } from './types'

export const VERIFIED_USER_HEADER = 'x-iconic-verified-uid'
export type { AuthUser } from './types'

export async function getRequestUser(): Promise<AuthUser | null> {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()])
  const verifiedId = requestHeaders.get(VERIFIED_USER_HEADER)
  const sid = cookieStore.get(SESSION_COOKIE)?.value
  const session = verifiedId ? null : await getSession(sid)
  const userId = verifiedId ?? session?.userId
  if (!userId) return null

  const [credential] = await db
    .select({ email: authCredentials.email })
    .from(authCredentials)
    .where(eq(authCredentials.userId, userId))
    .limit(1)

  if (!credential) return null
  return { id: userId, email: credential?.email ?? null }
}
