import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { asc, eq } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'
import { isValidRoleForType } from '@/src/lib/auth/role'

// Lightweight lab/client list (id + display name only) for the lab filter on
// the internal cases pages. Unlike /api/admin/clients (admin-only, full
// profile rows), this is open to every admin-portal role — QC, designer,
// account manager — and exposes nothing beyond the name.
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [me] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!me || !isValidRoleForType('admin_portal', me.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rows = await db
      .select({ id: profiles.id, labName: profiles.labName, fullName: profiles.fullName, email: profiles.email })
      .from(profiles)
      .where(eq(profiles.role, 'client'))
      .orderBy(asc(profiles.labName))

    return NextResponse.json(
      rows.map((r) => ({ id: r.id, name: r.labName || r.fullName || r.email }))
    )
  } catch (error) {
    console.error('[admin/clients/options GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
