import { and, count, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/src/db'
import { invoiceCases, invoices } from '@/src/db/schema/invoice'
import { cases } from '@/src/db/schema/case'

/** Case ids per invoice (replaces the old invoices.case_ids jsonb array). One indexed query for N invoices. */
export async function getInvoiceCaseIds(invoiceIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!invoiceIds.length) return map
  const rows = await db.select({ invoiceId: invoiceCases.invoiceId, caseId: invoiceCases.caseId })
    .from(invoiceCases).where(inArray(invoiceCases.invoiceId, invoiceIds))
  for (const r of rows) {
    const list = map.get(r.invoiceId) ?? []
    list.push(r.caseId)
    map.set(r.invoiceId, list)
  }
  return map
}

export async function countInvoiceCases(invoiceIds: string[]): Promise<Map<string, number>> {
  if (!invoiceIds.length) return new Map()
  const rows = await db.select({ invoiceId: invoiceCases.invoiceId, n: count() })
    .from(invoiceCases).where(inArray(invoiceCases.invoiceId, invoiceIds)).groupBy(invoiceCases.invoiceId)
  return new Map(rows.map((r) => [r.invoiceId, Number(r.n)]))
}

export type DuplicateBillingWarning = {
  caseId: string
  caseNumber: string
  invoiceId: string
  invoiceNumber: string
  status: string
}

/**
 * Re-billing is allowed but must be confirmed: lists earlier invoices that already contain any of these cases
 * (served by idx_invoice_cases_case). `excludeInvoiceId` = the invoice being edited.
 */
export async function findDuplicateBilling(caseIds: string[], excludeInvoiceId?: string): Promise<DuplicateBillingWarning[]> {
  if (!caseIds.length) return []
  return db
    .select({
      caseId: invoiceCases.caseId,
      caseNumber: cases.caseNumber,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
    })
    .from(invoiceCases)
    .innerJoin(invoices, eq(invoices.id, invoiceCases.invoiceId))
    .innerJoin(cases, eq(cases.id, invoiceCases.caseId))
    .where(and(
      inArray(invoiceCases.caseId, caseIds),
      excludeInvoiceId ? ne(invoiceCases.invoiceId, excludeInvoiceId) : undefined,
    ))
}
