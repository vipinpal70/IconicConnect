import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { supabaseAdmin } from '@/src/lib/supabase/admin'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import { logActivity } from '@/src/lib/activity-log'

// DELETE /api/admin/milling/users/[id] — removes a milling portal user.
// Tolerant of the auth user already being missing (the orphaned-profile
// case the credentials-reset endpoint tells admins to recover from here).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const [user] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    if (!user || user.userType !== 'milling_portal') {
      return NextResponse.json({ error: 'Milling user not found' }, { status: 404 })
    }

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id)
    if (authError && !/user not found/i.test(authError.message)) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    await db.delete(profiles).where(eq(profiles.id, id))

    await logActivity({
      actor: auth.profile,
      action: 'milling_user.deleted',
      details: { userId: id, email: user.email, millingCenterId: user.millingCenterId },
    }).catch((err) => console.error('[milling_user.deleted logActivity]', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/milling/users/[id] DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
