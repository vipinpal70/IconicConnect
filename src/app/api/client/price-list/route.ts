import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { eq } from 'drizzle-orm'
import { resolveClientIdFromProfile, getPriceListForClient } from '@/src/lib/price-list'

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

    const data = await getPriceListForClient(auth.clientId)
    return NextResponse.json({ data })
  } catch (error) {
    console.error('[client/price-list GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
