import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { invoices } from '@/src/db/schema/invoice'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'
import { formatInvoiceRow } from '@/src/lib/invoice'

async function resolveClientId(userId: string): Promise<string | null> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1)
  if (!profile) return null
  return profile.role === 'subuser' && profile.createdBy ? profile.createdBy : profile.id
}

// GET /api/client/invoices/[id] — fetch single invoice for the client
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const clientId = await resolveClientId(user.id)
    if (!clientId) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const { id } = await params
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (inv.clientId !== clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const [client] = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1)
    return NextResponse.json(formatInvoiceRow(inv, client))
  } catch (err) {
    console.error('[api/client/invoices/[id] GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/client/invoices/[id] — client marks invoice as paid
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const clientId = await resolveClientId(user.id)
    if (!clientId) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const { id } = await params
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (inv.clientId !== clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()

    // Clients may only toggle their own paid status
    if (typeof body.clientPaid !== 'boolean') {
      return NextResponse.json({ error: 'clientPaid (boolean) is required' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {
      clientPaid: body.clientPaid,
      updatedAt: new Date(),
    }

    if (body.clientPaid) {
      updates.clientPaymentDate =
        body.clientPaymentDate ?? new Date().toISOString().split('T')[0]
      updates.status = 'paid'
    } else {
      updates.clientPaymentDate = null
      updates.status = 'pending'
    }

    const [updated] = await db
      .update(invoices)
      .set(updates as any)
      .where(eq(invoices.id, id))
      .returning()

    const [client] = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1)
    return NextResponse.json(formatInvoiceRow(updated, client))
  } catch (err) {
    console.error('[api/client/invoices/[id] PATCH]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
