import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles, users } from '@/src/db/schema/profile'
import { eq, getTableColumns } from 'drizzle-orm'
import { createClient } from '@/src/lib/auth/server'
import { getCachedData, setCachedData } from '@/src/lib/redis-cache'

const CLIENTS_LIST_KEY = 'clients:list:v2'
const CLIENTS_LIST_TTL = 3600 // 1 hour

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Role comes from the Redis session — no DB read needed for the authorization check.
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Legacy full-list endpoint (billing / offers / cases pickers). The Clients page uses /api/admin/clients/list.
    // ?refresh=true bypasses Redis and re-populates it from a fresh DB read —
    // used by the admin UI's "hard refresh" button.
    const forceRefresh = new URL(req.url).searchParams.get('refresh') === 'true'

    if (!forceRefresh) {
      const cached = await getCachedData<Array<typeof profiles.$inferSelect & { email: string }>>(CLIENTS_LIST_KEY)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    // Fetch all clients
    // email lives in `users` now (single source of truth), so it must be joined in.
    const allClients = await db.select({ ...getTableColumns(profiles), email: users.email })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.id))
      .where(eq(profiles.role, 'client'))
      .orderBy(profiles.createdAt)

    await setCachedData(CLIENTS_LIST_KEY, allClients, CLIENTS_LIST_TTL)
    return NextResponse.json(allClients, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' },
    })
  } catch (err) {
    console.error('[admin/clients GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
