import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { getCachedData, setCachedData } from '@/src/lib/redis-cache'

const CLIENT_TTL = 3600 // 1 hour
const clientKey = (id: string) => `client:${id}`

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const key = clientKey(id)

    const cached = await getCachedData<typeof profiles.$inferSelect>(key)
    if (cached) {
      return NextResponse.json({ data: cached })
    }

    const [client] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)

    if (!client || client.role !== 'client') {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    await setCachedData(key, client, CLIENT_TTL)
    return NextResponse.json({ data: client })
  } catch (error) {
    console.error('[admin/clients/[id] GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
