import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCenters, millingServiceCatalog } from '@/src/db/schema/milling'
import { serviceTypeEnum } from '@/src/db/schema/case'
import { requireAdmin } from '@/src/lib/milling/admin-guard'

type ServiceType = (typeof serviceTypeEnum.enumValues)[number]

function parseServiceType(value: string | null): ServiceType | null {
  if (!value) return null
  return (serviceTypeEnum.enumValues as readonly string[]).includes(value) ? (value as ServiceType) : null
}

// Admin always sees every row (including disabled ones) for a centre+flow —
// unlike the client-facing catalog, there's no separate "includeInactive"
// toggle since re-enabling a row requires seeing it first.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id: centerId } = await params
    const serviceType = parseServiceType(new URL(req.url).searchParams.get('serviceType'))
    if (!serviceType) {
      return NextResponse.json({ error: 'Invalid or missing serviceType' }, { status: 400 })
    }

    const data = await db
      .select()
      .from(millingServiceCatalog)
      .where(and(eq(millingServiceCatalog.millingCenterId, centerId), eq(millingServiceCatalog.serviceType, serviceType)))
      .orderBy(millingServiceCatalog.category, millingServiceCatalog.subCategory)

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[admin/milling/centers/[id]/service-catalog GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface CatalogItemInput {
  id?: string
  category: string
  subCategory: string
  unitType: string
  partnerRate: number | string
  monthlyCapacity?: number | null
  turnaroundDays?: number | null
  isActive?: boolean
  notes?: string | null
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id: centerId } = await params
    const serviceType = parseServiceType(new URL(req.url).searchParams.get('serviceType'))
    if (!serviceType) {
      return NextResponse.json({ error: 'Invalid or missing serviceType' }, { status: 400 })
    }

    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, centerId)).limit(1)
    if (!center) {
      return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({} as { items?: unknown[] }))
    const items = Array.isArray(body.items) ? (body.items as CatalogItemInput[]) : []

    const validated = items
      .map((item) => {
        if (!item.category || typeof item.category !== 'string') return null
        if (!item.subCategory || typeof item.subCategory !== 'string') return null
        if (!item.unitType || typeof item.unitType !== 'string') return null
        const partnerRate = Number(item.partnerRate)
        if (!Number.isFinite(partnerRate) || partnerRate < 0) return null
        return {
          category: item.category,
          subCategory: item.subCategory,
          unitType: item.unitType,
          partnerRate: partnerRate.toFixed(2),
          monthlyCapacity: item.monthlyCapacity === null || item.monthlyCapacity === undefined || item.monthlyCapacity === ('' as unknown)
            ? null
            : Number(item.monthlyCapacity),
          turnaroundDays: item.turnaroundDays === null || item.turnaroundDays === undefined || item.turnaroundDays === ('' as unknown)
            ? null
            : Number(item.turnaroundDays),
          isActive: typeof item.isActive === 'boolean' ? item.isActive : true,
          notes: item.notes?.trim() || null,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    if (validated.length > 0) {
      await db.transaction(async (tx) => {
        for (const item of validated) {
          await tx
            .insert(millingServiceCatalog)
            .values({
              millingCenterId: centerId,
              serviceType,
              category: item.category,
              subCategory: item.subCategory,
              unitType: item.unitType as (typeof millingServiceCatalog.$inferInsert)['unitType'],
              partnerRate: item.partnerRate,
              monthlyCapacity: item.monthlyCapacity,
              turnaroundDays: item.turnaroundDays,
              isActive: item.isActive,
              notes: item.notes,
            })
            .onConflictDoUpdate({
              target: [
                millingServiceCatalog.millingCenterId,
                millingServiceCatalog.serviceType,
                millingServiceCatalog.category,
                millingServiceCatalog.subCategory,
              ],
              set: {
                unitType: item.unitType as (typeof millingServiceCatalog.$inferInsert)['unitType'],
                partnerRate: item.partnerRate,
                monthlyCapacity: item.monthlyCapacity,
                turnaroundDays: item.turnaroundDays,
                isActive: item.isActive,
                notes: item.notes,
                updatedAt: new Date(),
              },
            })
        }
      })
    }

    const data = await db
      .select()
      .from(millingServiceCatalog)
      .where(and(eq(millingServiceCatalog.millingCenterId, centerId), eq(millingServiceCatalog.serviceType, serviceType)))
      .orderBy(millingServiceCatalog.category, millingServiceCatalog.subCategory)

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[admin/milling/centers/[id]/service-catalog PUT]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}