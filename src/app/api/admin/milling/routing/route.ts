import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { millingRoutingRules, millingCenters } from '@/src/db/schema/milling'
import { asc, eq } from 'drizzle-orm'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import { logActivity } from '@/src/lib/activity-log'

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const rules = await db.select().from(millingRoutingRules).orderBy(asc(millingRoutingRules.priority))
    return NextResponse.json({ data: rules })
  } catch (error) {
    console.error('[admin/milling/routing GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const body = await req.json()
    const { name, priority, scope, millingCenterId, fallbackMillingCenterId, active } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Rule name is required' }, { status: 400 })
    }
    if (!millingCenterId || typeof millingCenterId !== 'string') {
      return NextResponse.json({ error: 'millingCenterId is required' }, { status: 400 })
    }
    if (scope !== undefined && (typeof scope !== 'object' || scope === null || Array.isArray(scope))) {
      return NextResponse.json({ error: 'scope must be an object' }, { status: 400 })
    }

    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, millingCenterId)).limit(1)
    if (!center) {
      return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 })
    }

    if (fallbackMillingCenterId) {
      const [fallback] = await db.select().from(millingCenters).where(eq(millingCenters.id, fallbackMillingCenterId)).limit(1)
      if (!fallback) {
        return NextResponse.json({ error: 'Fallback milling centre not found' }, { status: 404 })
      }
    }

    const [rule] = await db
      .insert(millingRoutingRules)
      .values({
        name,
        priority: Number.isFinite(priority) ? priority : 10,
        scope: scope ?? {},
        millingCenterId,
        fallbackMillingCenterId: fallbackMillingCenterId || null,
        active: typeof active === 'boolean' ? active : true,
      })
      .returning()

    await logActivity({
      actor: auth.profile,
      action: 'milling_routing_rule.created',
      details: { ruleId: rule.id, name: rule.name },
    }).catch((err) => console.error('[milling_routing_rule.created logActivity]', err))

    return NextResponse.json({ data: rule }, { status: 201 })
  } catch (error) {
    console.error('[admin/milling/routing POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
