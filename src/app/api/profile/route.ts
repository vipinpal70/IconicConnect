import { getEmail } from '@/src/lib/auth/auth-service'
import { getRequestUser } from '@/src/lib/auth/request-user'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/auth/server'
import { getCachedData, setCachedData } from '@/src/lib/redis-cache'

const PROFILE_TTL = 3600 // 1 hour

export async function GET() {
  try {
    const supabase = await createClient()
    const user = await getRequestUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const key = `profile:${user.id}`
    const cached = await getCachedData<typeof profiles.$inferSelect>(key)
    if (cached) {
      return NextResponse.json(cached)
    }

    const results = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1)

    const row = results[0]

    if (!row) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Email lives in `users`, not `profiles`.
    const profile = { ...row, email: await getEmail(row.id) }

    await setCachedData(key, profile, PROFILE_TTL)
    return NextResponse.json(profile)
  } catch (error) {
    console.error('[api/profile] Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
