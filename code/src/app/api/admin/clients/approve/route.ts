import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if the requester is an admin
    const [adminProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!adminProfile || adminProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { clientId } = await req.json()
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
    }

    // Update client status to active
    await db.update(profiles)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(profiles.id, clientId))

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/clients/approve POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
