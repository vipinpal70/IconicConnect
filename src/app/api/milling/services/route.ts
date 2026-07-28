import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingServiceCatalog } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'

export async function GET() {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const services = await db
      .select()
      .from(millingServiceCatalog)
      .where(eq(millingServiceCatalog.millingCenterId, auth.millingCenterId))
      .orderBy(desc(millingServiceCatalog.createdAt))

    return NextResponse.json({ data: services })
  } catch (error) {
    console.error('[milling/services GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMillingUser(['milling_admin'])
  if ('error' in auth) return auth.error

  try {
    const body = await req.json()
    const { category, subCategory, unitType, partnerRate, turnaroundDays, notes } = body

    if (!category || !subCategory) {
      return NextResponse.json({ error: 'category and subCategory are required' }, { status: 400 })
    }
    if (!['per_tooth', 'per_arch', 'per_case'].includes(unitType)) {
      return NextResponse.json({ error: 'Invalid unitType' }, { status: 400 })
    }
    const rate = Number(partnerRate)
    if (!Number.isFinite(rate) || rate < 0) {
      return NextResponse.json({ error: 'partnerRate must be a non-negative number' }, { status: 400 })
    }

    const [service] = await db
      .insert(millingServiceCatalog)
      .values({
        millingCenterId: auth.millingCenterId,
        category,
        subCategory,
        unitType,
        partnerRate: rate.toFixed(2),
        turnaroundDays: Number.isFinite(turnaroundDays) ? turnaroundDays : null,
        notes: notes || null,
      })
      .returning()

    return NextResponse.json({ data: service }, { status: 201 })
  } catch (error) {
    console.error('[milling/services POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
