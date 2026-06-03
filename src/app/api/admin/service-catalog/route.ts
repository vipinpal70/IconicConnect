import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { serviceCatalog } from '@/src/db/schema/price-list'
import { createClient } from '@/src/lib/supabase/server'
import { eq } from 'drizzle-orm'
import { getServiceCatalog, updateCatalogDefaultPrices } from '@/src/lib/price-list'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile || profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile }
}

export async function GET() {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const data = await getServiceCatalog()
    return NextResponse.json({ data })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined
    console.error('[admin/service-catalog GET]', error)
    return NextResponse.json({ error: cause ? `${msg} — cause: ${cause}` : msg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const body = await req.json().catch(() => ({} as { items?: unknown[] }))
    const items = Array.isArray(body.items) ? body.items : []

    type RawItem = { id?: unknown; defaultPrice?: unknown }
    const validated = (items as RawItem[])
      .map((item) => {
        const price = Number(item.defaultPrice)
        if (!Number.isFinite(price) || price < 0) return null
        if (typeof item.id !== 'string') return null
        return { id: item.id, defaultPrice: price }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    await updateCatalogDefaultPrices(validated)

    const data = await getServiceCatalog()
    return NextResponse.json({ data })
  } catch (error) {
    console.error('[admin/service-catalog PUT]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
