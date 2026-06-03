import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { serviceCatalog } from '@/src/db/schema/price-list'
import { createClient } from '@/src/lib/supabase/server'
import { eq } from 'drizzle-orm'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rows = await db
      .select()
      .from(serviceCatalog)
      .where(eq(serviceCatalog.isActive, true))
      .orderBy(serviceCatalog.sortOrder)

    const data = rows.map((row) => ({
      id: row.id,
      catalogItemId: row.id,
      category: row.category,
      subCategory: row.subCategory,
      unitType: row.unitType,
      defaultPrice: Number(row.defaultPrice),
      price: Number(row.defaultPrice),
      notes: null,
      sortOrder: row.sortOrder,
    }))

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[admin/service-catalog GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
