import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'

export async function requireAdmin() {
  return requireStaffRole(['admin'])
}

// Same shape as requireAdmin, but for routes that non-admin internal staff
// (qc, designer) also need.
export async function requireStaffRole(allowedRoles: string[]) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (!allowedRoles.includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile }
}
