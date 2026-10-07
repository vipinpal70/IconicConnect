import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

export const VERIFIED_USER_HEADER = 'x-iconic-verified-uid'

/**
 * Current user for a route handler.
 *
 * src/proxy.ts runs on every non-static request, verifies the session with Supabase Auth and forwards the
 * user id in VERIFIED_USER_HEADER (stripping any client-supplied value first). Reusing it saves a second
 * Auth round trip per request. Use it for read-only handlers; mutations should keep calling
 * supabase.auth.getUser() directly. Falls back to getUser() when the header is absent (e.g. the proxy
 * did not run), so it can never be less strict than before.
 */
export async function getRequestUser(supabase: SupabaseClient): Promise<{ id: string } | null> {
  const id = (await headers()).get(VERIFIED_USER_HEADER)
  if (id) return { id }
  const { data: { user } } = await supabase.auth.getUser()
  return user ? { id: user.id } : null
}
