import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { invoices } from '@/src/db/schema/invoice'
import { profiles } from '@/src/db/schema/profile'
import { eq, desc } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'
import { formatInvoiceRow } from '@/src/lib/invoice'
import { getCachedData, setCachedData } from '@/src/lib/redis-cache'

const INVOICE_TTL = 1800 // 30 minutes

// GET /api/client/invoices — list invoices for the authenticated client
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Subusers share the lab's invoices — resolve via createdBy (parent id)
    const clientId = profile.role === 'subuser' && profile.createdBy ? profile.createdBy : profile.id

    const cacheKey = `invoices:client:${clientId}`
    const cached = await getCachedData<ReturnType<typeof formatInvoiceRow>[]>(cacheKey)
    if (cached) return NextResponse.json(cached)

    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.clientId, clientId))
      .orderBy(desc(invoices.createdAt))

    if (rows.length === 0) return NextResponse.json([])

    const [client] = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1)
    if (!client) return NextResponse.json([])

    const result = rows.map((inv) => formatInvoiceRow(inv, client))
    await setCachedData(cacheKey, result, INVOICE_TTL)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/client/invoices GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
