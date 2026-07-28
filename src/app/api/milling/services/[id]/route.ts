import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingServiceCatalog } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'

async function getOwnedService(id: string, millingCenterId: string) {
  const [service] = await db
    .select()
    .from(millingServiceCatalog)
    .where(and(eq(millingServiceCatalog.id, id), eq(millingServiceCatalog.millingCenterId, millingCenterId)))
    .limit(1)
  return service ?? null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMillingUser(['milling_admin'])
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const existing = await getOwnedService(id, auth.millingCenterId)
    if (!existing) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }

    const body = await req.json()
    const { category, subCategory, unitType, partnerRate, turnaroundDays, notes, isActive } = body

    const updates: Partial<typeof millingServiceCatalog.$inferInsert> = { updatedAt: new Date() }
    if (typeof category === 'string') updates.category = category
    if (typeof subCategory === 'string') updates.subCategory = subCategory
    if (unitType !== undefined) {
      if (!['per_tooth', 'per_arch', 'per_case'].includes(unitType)) {
        return NextResponse.json({ error: 'Invalid unitType' }, { status: 400 })
      }
      updates.unitType = unitType
    }
    if (partnerRate !== undefined) {
      const rate = Number(partnerRate)
      if (!Number.isFinite(rate) || rate < 0) {
        return NextResponse.json({ error: 'partnerRate must be a non-negative number' }, { status: 400 })
      }
      updates.partnerRate = rate.toFixed(2)
    }
    if (turnaroundDays !== undefined) updates.turnaroundDays = Number.isFinite(turnaroundDays) ? turnaroundDays : null
    if (notes !== undefined) updates.notes = notes || null
    if (typeof isActive === 'boolean') updates.isActive = isActive

    const [service] = await db
      .update(millingServiceCatalog)
      .set(updates)
      .where(eq(millingServiceCatalog.id, id))
      .returning()

    return NextResponse.json({ data: service })
  } catch (error) {
    console.error('[milling/services/[id] PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMillingUser(['milling_admin'])
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const existing = await getOwnedService(id, auth.millingCenterId)
    if (!existing) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }

    await db.delete(millingServiceCatalog).where(eq(millingServiceCatalog.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[milling/services/[id] DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
