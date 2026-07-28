import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { millingServiceCatalog, millingCenters } from '@/src/db/schema/milling'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/src/lib/milling/admin-guard'

// Read-only, cross-centre view of what every milling centre charges Iconic —
// admin cost reference only. Never exposed to milling centres or dental labs.
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const rows = await db
      .select({
        id: millingServiceCatalog.id,
        millingCenterId: millingServiceCatalog.millingCenterId,
        millingCenterName: millingCenters.name,
        category: millingServiceCatalog.category,
        subCategory: millingServiceCatalog.subCategory,
        unitType: millingServiceCatalog.unitType,
        partnerRate: millingServiceCatalog.partnerRate,
        turnaroundDays: millingServiceCatalog.turnaroundDays,
        isActive: millingServiceCatalog.isActive,
      })
      .from(millingServiceCatalog)
      .innerJoin(millingCenters, eq(millingCenters.id, millingServiceCatalog.millingCenterId))
      .where(eq(millingServiceCatalog.isActive, true))

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[admin/milling/service-catalog GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
