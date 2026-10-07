import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { getRequestUser } from '@/src/lib/auth/request-user'
import { isValidRoleForType } from '@/src/lib/auth/role'
import { getCachedData, setCachedData } from '@/src/lib/redis-cache'

const OPS_DASHBOARD_TTL = 60

/**
 * Shared shell for the per-section ops/admin-portal dashboard routes (/api/cases/dashboard/*): auth +
 * role gate + short Redis cache. The data is the same for every admin-portal role (they all see all cases),
 * so one shared cache key per section is safe; it is cleared by invalidateCasesCache().
 */
export async function opsDashboardSection<T>(section: string, compute: () => Promise<T>) {
  try {
    const user = await getRequestUser(await createClient())
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [profile] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    if (!isValidRoleForType('admin_portal', profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const key = `dashboard:ops:${section}`
    const cached = await getCachedData<T>(key)
    if (cached) return NextResponse.json(cached)

    const payload = await compute()
    await setCachedData(key, payload, OPS_DASHBOARD_TTL)
    return NextResponse.json(payload)
  } catch (error) {
    console.error(`[ops dashboard:${section}]`, error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
