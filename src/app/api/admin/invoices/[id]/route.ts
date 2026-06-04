import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { invoices } from '@/src/db/schema/invoice'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'
import {
  computeAdjustment,
  computeTotal,
  formatInvoiceRow,
} from '@/src/lib/invoice'
import type { AdjustmentType } from '@/src/db/schema/invoice'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile || profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { profile }
}

// GET /api/admin/invoices/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const [client] = await db.select().from(profiles).where(eq(profiles.id, inv.clientId)).limit(1)
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    return NextResponse.json(formatInvoiceRow(inv, client))
  } catch (err) {
    console.error('[api/admin/invoices/[id] GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/admin/invoices/[id] — update status or adjustments
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const body = await req.json()
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    // Status toggle
    if (body.status !== undefined) {
      if (!['pending', 'paid'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      updates.status = body.status
    }

    // Remarks / terms
    if (body.remarks !== undefined) updates.remarks = body.remarks
    if (body.termsOfPayment !== undefined) updates.termsOfPayment = body.termsOfPayment

    // Client payment tracking
    if (body.clientPaid !== undefined) {
      updates.clientPaid = Boolean(body.clientPaid)
      if (body.clientPaid === true) {
        // auto-fill today if no date provided
        updates.clientPaymentDate =
          body.clientPaymentDate ?? new Date().toISOString().split('T')[0]
        // keep status in sync: client paid → overall invoice paid
        updates.status = 'paid'
      } else {
        updates.clientPaymentDate = null
        updates.status = 'pending'
      }
    }

    // Admin receipt confirmation
    if (body.received !== undefined) {
      updates.received = Boolean(body.received)
      if (body.received === true) {
        updates.receivedConfirmationId = body.receivedConfirmationId ?? null
        updates.receivedOn =
          body.receivedOn ?? new Date().toISOString().split('T')[0]
      } else {
        updates.receivedConfirmationId = null
        updates.receivedOn = null
      }
    }

    // Re-compute adjustments if any adjustment field changes
    const hasAdjustmentChange =
      body.taxType !== undefined ||
      body.taxValue !== undefined ||
      body.discountType !== undefined ||
      body.discountValue !== undefined ||
      body.extraChargesType !== undefined ||
      body.extraChargesValue !== undefined

    if (hasAdjustmentChange) {
      const subtotal = parseFloat(String(inv.subtotal))

      const taxType = (body.taxType ?? inv.taxType) as AdjustmentType
      const taxValue = Number(body.taxValue ?? inv.taxValue)
      const discountType = (body.discountType ?? inv.discountType) as AdjustmentType
      const discountValue = Number(body.discountValue ?? inv.discountValue)
      const extraChargesType = (body.extraChargesType ?? inv.extraChargesType) as AdjustmentType
      const extraChargesValue = Number(body.extraChargesValue ?? inv.extraChargesValue)

      const taxAmount = computeAdjustment(subtotal, taxValue, taxType)
      const discountAmount = computeAdjustment(subtotal, discountValue, discountType)
      const extraChargesAmount = computeAdjustment(subtotal, extraChargesValue, extraChargesType)
      const total = computeTotal(subtotal, taxAmount, discountAmount, extraChargesAmount)

      Object.assign(updates, {
        taxType,
        taxValue: String(taxValue),
        taxAmount: String(taxAmount),
        discountType,
        discountValue: String(discountValue),
        discountAmount: String(discountAmount),
        extraChargesType,
        extraChargesValue: String(extraChargesValue),
        extraChargesAmount: String(extraChargesAmount),
        total: String(total),
      })
    }

    const [updated] = await db
      .update(invoices)
      .set(updates as any)
      .where(eq(invoices.id, id))
      .returning()

    const [client] = await db.select().from(profiles).where(eq(profiles.id, updated.clientId)).limit(1)
    return NextResponse.json(formatInvoiceRow(updated, client))
  } catch (err) {
    console.error('[api/admin/invoices/[id] PATCH]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
