import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { invoices } from '@/src/db/schema/invoice'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'

// GET /api/admin/invoices/client-payments
// Returns per-client latest invoice payment status for the clients list indicator
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [admin] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rows = await db
      .select({
        clientId: invoices.clientId,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        clientPaid: invoices.clientPaid,
        clientPaymentDate: invoices.clientPaymentDate,
        received: invoices.received,
        total: invoices.total,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .orderBy(invoices.createdAt)

    // Group by clientId — keep latest invoice per client
    const map = new Map<
      string,
      {
        clientId: string
        invoiceId: string
        invoiceNumber: string
        clientPaid: boolean
        clientPaymentDate: string | null
        received: boolean
        pendingCount: number
        totalInvoices: number
      }
    >()

    for (const row of rows) {
      const existing = map.get(row.clientId)
      const pending = !row.clientPaid ? 1 : 0

      if (!existing) {
        map.set(row.clientId, {
          clientId: row.clientId,
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          clientPaid: row.clientPaid ?? false,
          clientPaymentDate: row.clientPaymentDate ?? null,
          received: row.received ?? false,
          pendingCount: pending,
          totalInvoices: 1,
        })
      } else {
        // Update to the newest invoice (rows are ordered asc, so keep updating)
        existing.invoiceId = row.invoiceId
        existing.invoiceNumber = row.invoiceNumber
        existing.clientPaid = row.clientPaid ?? false
        existing.clientPaymentDate = row.clientPaymentDate ?? null
        existing.received = row.received ?? false
        existing.pendingCount += pending
        existing.totalInvoices += 1
      }
    }

    return NextResponse.json(Object.fromEntries(map))
  } catch (err) {
    console.error('[api/admin/invoices/client-payments GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
