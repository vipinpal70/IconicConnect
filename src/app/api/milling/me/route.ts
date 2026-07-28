import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCenters } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'

export async function GET() {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const { profile, millingCenterId } = auth
    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, millingCenterId)).limit(1)

    return NextResponse.json({
      data: {
        id: profile.id,
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        role: profile.role,
        center: center
          ? {
              id: center.id,
              name: center.name,
              city: center.city,
              state: center.state,
              country: center.country,
              active: center.active,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('[milling/me GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
