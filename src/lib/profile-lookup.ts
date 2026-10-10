import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, type Profile } from '@/src/db/schema/profile'

// Short per-process cache of the full profile row for READ-ONLY handlers. Every request otherwise pays one
// database round trip just to learn who the caller is (and with a remote database that is ~100-300 ms).
// A role/status change takes effect within PROFILE_TTL_MS — the same trade-off src/proxy.ts already makes
// for its gate cache (15 s). Mutations should keep reading the profile directly.
const PROFILE_TTL_MS = 10_000
const PROFILE_MAX = 2_000
const cache = new Map<string, { value: Profile; expires: number }>()

export async function getProfileCached(userId: string): Promise<Profile | null> {
  const now = Date.now()
  const hit = cache.get(userId)
  if (hit && hit.expires > now) return hit.value

  const [row] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1)
  if (!row) return null // never cache "no profile": a freshly created account must be picked up at once

  if (cache.size >= PROFILE_MAX) {
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k)
    if (cache.size >= PROFILE_MAX) cache.clear()
  }
  cache.set(userId, { value: row, expires: now + PROFILE_TTL_MS })
  return row
}
