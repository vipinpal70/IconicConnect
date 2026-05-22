import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { clientPriceListItems } from '@/src/db/schema/client-price-list'
import { createClient } from '@/src/lib/supabase/server'
import { normalizePriceListItems, type PriceListItemInput } from '@/src/lib/client-price-list'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile }
}

async function getClient(id: string) {
  const [client] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
  if (!client || client.role !== 'client') return null
  return client
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const client = await getClient(id)
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const rows = await db
      .select()
      .from(clientPriceListItems)
      .where(eq(clientPriceListItems.clientId, id))
      .orderBy(clientPriceListItems.sortOrder, clientPriceListItems.createdAt)

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[admin/clients/[id]/price-list GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const client = await getClient(id)
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({} as { items?: PriceListItemInput[] }))
    const items = Array.isArray(body.items) ? body.items : []
    const normalized = normalizePriceListItems(items)

    const rows = await db.transaction(async (tx) => {
      await tx.delete(clientPriceListItems).where(eq(clientPriceListItems.clientId, id))

      if (normalized.length === 0) {
        return []
      }

      return await tx
        .insert(clientPriceListItems)
        .values(
          normalized.map((item, index) => ({
            clientId: id,
            serviceName: item.serviceName,
            price: item.price,
            notes: item.notes,
            sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : index,
          }))
        )
        .returning()
    })

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[admin/clients/[id]/price-list PUT]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
