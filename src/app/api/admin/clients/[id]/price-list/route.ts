import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { getPriceListForClient, updateClientPriceList } from '@/src/lib/price-list'
import { logActivity } from '@/src/lib/activity-log'

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

    const data = await getPriceListForClient(id)
    return NextResponse.json({ data })
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

    const body = await req.json().catch(() => ({} as { items?: unknown[] }))
    const items = Array.isArray(body.items) ? body.items : []

    type RawItem = { catalogItemId?: unknown; price?: unknown; notes?: unknown }
    const validated = (items as RawItem[])
      .map((item) => {
        const price = Number(item.price)
        if (!Number.isFinite(price) || price < 0) return null
        if (typeof item.catalogItemId !== 'string') return null
        return {
          catalogItemId: item.catalogItemId,
          price,
          notes: typeof item.notes === 'string' ? item.notes : null,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    await updateClientPriceList(id, validated, auth.profile.id)

    const data = await getPriceListForClient(id)

    await logActivity({
      actor: auth.profile,
      action: 'price_list.updated',
      details: { clientId: id, itemCount: validated.length },
    }).catch((err) => console.error('[price_list.updated logActivity]', err))

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[admin/clients/[id]/price-list PUT]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
