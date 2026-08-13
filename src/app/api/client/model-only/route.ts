import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { resolveClientIdFromProfile } from '@/src/lib/price-list'

// Whether the logged-in client (or their parent, for a subuser) is
// restricted to "3D Model" category cases only. See
// 3d-model-implement-plan.md §3.
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const clientId = await resolveClientIdFromProfile(profile.id, profile.role)
    if (!clientId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [client] = await db.select({ modelOnlyLab: profiles.modelOnlyLab }).from(profiles).where(eq(profiles.id, clientId)).limit(1)
    return NextResponse.json({ data: { modelOnlyLab: client?.modelOnlyLab ?? false } })
  } catch (error) {
    console.error('[client/model-only GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
