import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'
import { getCachedData, setCachedData } from '@/src/lib/redis-cache'

const CLIENTS_LIST_KEY = 'clients:list'
const CLIENTS_LIST_TTL = 3600 // 1 hour

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

    const cached = await getCachedData<typeof profiles.$inferSelect[]>(CLIENTS_LIST_KEY)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Fetch all clients
    const allClients = await db.select()
      .from(profiles)
      .where(eq(profiles.role, 'client'))
      .orderBy(profiles.createdAt)

    await setCachedData(CLIENTS_LIST_KEY, allClients, CLIENTS_LIST_TTL)
    return NextResponse.json(allClients)
  } catch (err) {
    console.error('[admin/clients GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
