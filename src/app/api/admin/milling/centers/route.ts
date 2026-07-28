import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { millingCenters } from '@/src/db/schema/milling'
import { desc } from 'drizzle-orm'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import { logActivity } from '@/src/lib/activity-log'

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const centers = await db.select().from(millingCenters).orderBy(desc(millingCenters.createdAt))
    return NextResponse.json({ data: centers })
  } catch (error) {
    console.error('[admin/milling/centers GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const body = await req.json()
    const { name, contactName, email, phone, city, state, country } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Centre name is required' }, { status: 400 })
    }

    const [center] = await db
      .insert(millingCenters)
      .values({
        name,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        city: city || null,
        state: state || null,
        country: country || null,
        onboardedAt: new Date().toISOString().slice(0, 10),
      })
      .returning()

    await logActivity({
      actor: auth.profile,
      action: 'milling_center.created',
      details: { centerId: center.id, name: center.name },
    }).catch((err) => console.error('[milling_center.created logActivity]', err))

    return NextResponse.json({ data: center }, { status: 201 })
  } catch (error) {
    console.error('[admin/milling/centers POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
