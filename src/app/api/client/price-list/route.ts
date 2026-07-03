import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { eq } from 'drizzle-orm'
import { resolveClientIdFromProfile, getPriceListForClient } from '@/src/lib/price-list'
import { getCachedData, setCachedData } from '@/src/lib/redis-cache'
import type { PriceListEntryFull } from '@/src/lib/price-list'

const PRICE_LIST_TTL = 3600 // 1 hour
const cacheKey = (clientId: string) => `price-list:client:${clientId}`

async function requireClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  const clientId = await resolveClientIdFromProfile(profile.id, profile.role)
  if (!clientId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile, clientId }
}

export async function GET() {
  try {
    const auth = await requireClient()
    if ('error' in auth) return auth.error

    const key = cacheKey(auth.clientId)
    const cached = await getCachedData<PriceListEntryFull[]>(key)
    if (cached) {
      return NextResponse.json({ data: cached })
    }

    const data = await getPriceListForClient(auth.clientId)
    await setCachedData(key, data, PRICE_LIST_TTL)
    return NextResponse.json({ data })
  } catch (error) {
    console.error('[client/price-list GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
