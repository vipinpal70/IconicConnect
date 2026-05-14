import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq, and } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'

export async function GET(req: NextRequest) {
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

    // Fetch all clients
    const allClients = await db.select()
      .from(profiles)
      .where(eq(profiles.role, 'client'))
      .orderBy(profiles.createdAt)

    return NextResponse.json(allClients)
  } catch (err) {
    console.error('[admin/clients GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
