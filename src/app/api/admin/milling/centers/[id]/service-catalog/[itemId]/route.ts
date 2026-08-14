import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingServiceCatalog } from '@/src/db/schema/milling'
import { requireAdmin } from '@/src/lib/milling/admin-guard'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id: centerId, itemId } = await params

    const [deleted] = await db
      .delete(millingServiceCatalog)
      .where(and(eq(millingServiceCatalog.id, itemId), eq(millingServiceCatalog.millingCenterId, centerId)))
      .returning()

    if (!deleted) {
      return NextResponse.json({ error: 'Service catalog item not found' }, { status: 404 })
    }

    return NextResponse.json({ data: deleted })
  } catch (error) {
    console.error('[admin/milling/centers/[id]/service-catalog/[itemId] DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}