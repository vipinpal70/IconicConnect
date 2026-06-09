import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { invoices } from '@/src/db/schema/invoice'
import { profiles } from '@/src/db/schema/profile'
import { eq, desc } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'
import {
  buildInvoiceItems,
  computeAdjustment,
  computeTotal,
  generateInvoiceNumber,
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

// GET /api/admin/invoices — list all invoices with client info
export async function GET() {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const rows = await db
      .select()
      .from(invoices)
      .orderBy(desc(invoices.createdAt))

    const clientIds = [...new Set(rows.map((r) => r.clientId))]
    const clientRows = clientIds.length
      ? await db.select().from(profiles).where(
          clientIds.length === 1
            ? eq(profiles.id, clientIds[0])
            : eq(profiles.role, 'client') // fallback, filtered below
        )
      : []

    const clientMap = new Map(clientRows.map((c) => [c.id, c]))

    const result = rows.map((inv) => {
      const client = clientMap.get(inv.clientId)
      if (!client) return null
      return formatInvoiceRow(inv, client)
    }).filter(Boolean)

    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/admin/invoices GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/invoices — create and persist an invoice
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const body = await req.json()
    const {
      clientId,
      startDate,
      endDate,
      caseIds,
      taxType = 'percent',
      taxValue = 0,
      discountType = 'percent',
      discountValue = 0,
      extraChargesType = 'percent',
      extraChargesValue = 0,
      remarks = null,
      termsOfPayment = '7 Days',
    } = body

    if (!clientId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'clientId, startDate and endDate are required' },
        { status: 400 }
      )
    }

    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one case' }, { status: 400 })
    }

    // Verify client exists
    const [client] = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1)
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Build aggregated line items
    const { items, subtotal } = await buildInvoiceItems(clientId, caseIds)
    if (!items.length) {
      return NextResponse.json(
        { error: 'Could not price any of the selected cases' },
        { status: 422 }
      )
    }

    // Compute adjustments
    const taxAmt = computeAdjustment(subtotal, Number(taxValue), taxType as AdjustmentType)
    const discountAmt = computeAdjustment(subtotal, Number(discountValue), discountType as AdjustmentType)
    const extraAmt = computeAdjustment(subtotal, Number(extraChargesValue), extraChargesType as AdjustmentType)
    const total = computeTotal(subtotal, taxAmt, discountAmt, extraAmt)

    const invoiceNumber = await generateInvoiceNumber()

    const [saved] = await db
      .insert(invoices)
      .values({
        invoiceNumber,
        clientId,
        startDate,
        endDate,
        items,
        caseIds,
        subtotal: String(subtotal),
        taxType,
        taxValue: String(taxValue),
        taxAmount: String(taxAmt),
        discountType,
        discountValue: String(discountValue),
        discountAmount: String(discountAmt),
        extraChargesType,
        extraChargesValue: String(extraChargesValue),
        extraChargesAmount: String(extraAmt),
        total: String(total),
        status: 'pending',
        remarks: remarks || null,
        termsOfPayment,
        createdBy: auth.profile.id,
      })
      .returning()

    return NextResponse.json(formatInvoiceRow(saved, client), { status: 201 })
  } catch (err) {
    console.error('[api/admin/invoices POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
