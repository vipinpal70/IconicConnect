import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingRoutingRules, millingCenters } from '@/src/db/schema/milling'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import { logActivity } from '@/src/lib/activity-log'

async function getRule(id: string) {
  const [rule] = await db.select().from(millingRoutingRules).where(eq(millingRoutingRules.id, id)).limit(1)
  return rule ?? null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const existing = await getRule(id)
    if (!existing) {
      return NextResponse.json({ error: 'Routing rule not found' }, { status: 404 })
    }

    const body = await req.json()
    const { name, priority, scope, millingCenterId, fallbackMillingCenterId, active } = body

    if (scope !== undefined && (typeof scope !== 'object' || scope === null || Array.isArray(scope))) {
      return NextResponse.json({ error: 'scope must be an object' }, { status: 400 })
    }

    if (millingCenterId) {
      const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, millingCenterId)).limit(1)
      if (!center) {
        return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 })
      }
    }
    if (fallbackMillingCenterId) {
      const [fallback] = await db.select().from(millingCenters).where(eq(millingCenters.id, fallbackMillingCenterId)).limit(1)
      if (!fallback) {
        return NextResponse.json({ error: 'Fallback milling centre not found' }, { status: 404 })
      }
    }

    const updates: Partial<typeof millingRoutingRules.$inferInsert> = { updatedAt: new Date() }
    if (typeof name === 'string') updates.name = name
    if (Number.isFinite(priority)) updates.priority = priority
    if (scope !== undefined) updates.scope = scope
    if (typeof millingCenterId === 'string') updates.millingCenterId = millingCenterId
    if (fallbackMillingCenterId !== undefined) updates.fallbackMillingCenterId = fallbackMillingCenterId || null
    if (typeof active === 'boolean') updates.active = active

    const [rule] = await db
      .update(millingRoutingRules)
      .set(updates)
      .where(eq(millingRoutingRules.id, id))
      .returning()

    await logActivity({
      actor: auth.profile,
      action: 'milling_routing_rule.updated',
      details: { ruleId: id, changes: updates },
    }).catch((err) => console.error('[milling_routing_rule.updated logActivity]', err))

    return NextResponse.json({ data: rule })
  } catch (error) {
    console.error('[admin/milling/routing/[id] PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const existing = await getRule(id)
    if (!existing) {
      return NextResponse.json({ error: 'Routing rule not found' }, { status: 404 })
    }

    await db.delete(millingRoutingRules).where(eq(millingRoutingRules.id, id))

    await logActivity({
      actor: auth.profile,
      action: 'milling_routing_rule.deleted',
      details: { ruleId: id, name: existing.name },
    }).catch((err) => console.error('[milling_routing_rule.deleted logActivity]', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/milling/routing/[id] DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
