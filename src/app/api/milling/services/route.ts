import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCenters, millingServiceCatalog } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'

// View-only, permanently — milling-portal-plan.md §7. There is deliberately
// no PUT/DELETE handler on this route: editing a centre's service catalog
// (enabling a flow, setting partnerRate/turnaround/monthlyCapacity) stays an
// admin-only action via /api/admin/milling/centers/[id]/service-catalog.
// This is a separate route, not a relaxed-auth version of that one, so there
// is no code path through which a centre could end up writing to its own
// catalog.
export async function GET() {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, auth.millingCenterId)).limit(1)
    if (!center) {
      return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 })
    }

    const catalog = await db
      .select({
        id: millingServiceCatalog.id,
        serviceType: millingServiceCatalog.serviceType,
        category: millingServiceCatalog.category,
        subCategory: millingServiceCatalog.subCategory,
        unitType: millingServiceCatalog.unitType,
        partnerRate: millingServiceCatalog.partnerRate,
        monthlyCapacity: millingServiceCatalog.monthlyCapacity,
        turnaroundDays: millingServiceCatalog.turnaroundDays,
        isActive: millingServiceCatalog.isActive,
      })
      .from(millingServiceCatalog)
      .where(eq(millingServiceCatalog.millingCenterId, auth.millingCenterId))
      .orderBy(millingServiceCatalog.serviceType, millingServiceCatalog.category, millingServiceCatalog.subCategory)

    return NextResponse.json({
      data: {
        enabledServiceTypes: center.enabledServiceTypes ?? [],
        catalog,
      },
    })
  } catch (error) {
    console.error('[milling/services GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
