import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, type Profile } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'

export const MILLING_ROLES = ['milling_admin', 'milling_production', 'milling_support'] as const
export type MillingRole = (typeof MILLING_ROLES)[number]

export interface MillingAuth {
  profile: Profile
  millingCenterId: string
}

/**
 * Verifies the caller is a milling-portal user scoped to a centre. Pass
 * `allowedRoles` to further restrict to e.g. milling_admin-only endpoints.
 * All milling API routes must go through this — it's what keeps every
 * response scoped to `profile.millingCenterId`.
 */
export async function requireMillingUser(
  allowedRoles?: readonly MillingRole[]
): Promise<{ error: NextResponse } | MillingAuth> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (profile.userType !== 'milling_portal' || !profile.millingCenterId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  if (allowedRoles && !allowedRoles.includes(profile.role as MillingRole)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile, millingCenterId: profile.millingCenterId }
}
