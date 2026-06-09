import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { invoices } from '@/src/db/schema/invoice'
import { serviceCatalog, clientPriceList } from '@/src/db/schema/price-list'
import { profiles } from '@/src/db/schema/profile'
import { mapCaseToPricingInput } from '@/src/lib/pricing'
import { eq, and, inArray, like, desc } from 'drizzle-orm'
import type { InvoiceLineItem, AdjustmentType } from '@/src/db/schema/invoice'

// ── Adjustment calculations ─────────────────────────────────────────────────

export function computeAdjustment(
  subtotal: number,
  value: number,
  type: AdjustmentType
): number {
  if (!value || value <= 0) return 0
  return type === 'percent' ? parseFloat(((subtotal * value) / 100).toFixed(2)) : value
}

export function computeTotal(
  subtotal: number,
  taxAmount: number,
  discountAmount: number,
  extraChargesAmount: number
): number {
  return parseFloat((subtotal + taxAmount - discountAmount + extraChargesAmount).toFixed(2))
}

// ── Invoice number generation ────────────────────────────────────────────────

export async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `Inv_${year}_`

  const [latest] = await db
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(like(invoices.invoiceNumber, `${prefix}%`))
    .orderBy(desc(invoices.invoiceNumber))
    .limit(1)

  let seq = 1
  if (latest?.invoiceNumber) {
    const parts = latest.invoiceNumber.split('_')
    const lastSeq = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastSeq)) seq = lastSeq + 1
  }

  return `${prefix}${String(seq).padStart(4, '0')}`
}

// ── Unit count extraction from subTypeData ──────────────────────────────────

function extractUnitCount(unitType: 'per_tooth' | 'per_arch', subTypeData: any): number {
  if (unitType === 'per_tooth') {
    const teeth = subTypeData?.teeth
    if (Array.isArray(teeth) && teeth.length > 0) return teeth.length
    const crownTeeth = subTypeData?.crownBridgeTeeth
    if (Array.isArray(crownTeeth) && crownTeeth.length > 0) return crownTeeth.length
    return 1
  }
  // per_arch
  const arch = subTypeData?.arch || subTypeData?.caseType2 || 'Upper'
  const archStr = String(arch).toLowerCase()
  if (archStr.includes('both') || archStr.includes('full')) return 2
  return 1
}

// ── Client price lookup ─────────────────────────────────────────────────────

async function getUnitPrice(
  clientId: string,
  category: string,
  subCategory: string
): Promise<number> {
  // Try client-specific price first
  const [row] = await db
    .select({ price: clientPriceList.price, defaultPrice: serviceCatalog.defaultPrice })
    .from(serviceCatalog)
    .leftJoin(
      clientPriceList,
      and(
        eq(clientPriceList.catalogItemId, serviceCatalog.id),
        eq(clientPriceList.clientId, clientId)
      )
    )
    .where(
      and(eq(serviceCatalog.category, category), eq(serviceCatalog.subCategory, subCategory))
    )
    .limit(1)

  if (!row) return 0
  return parseFloat(String(row.price ?? row.defaultPrice ?? '0'))
}

// ── Core: build aggregated line items from selected case IDs ─────────────────

export async function buildInvoiceItems(
  clientId: string,
  caseIds: string[]
): Promise<{ items: InvoiceLineItem[]; subtotal: number }> {
  if (!caseIds.length) return { items: [], subtotal: 0 }

  const selectedCases = await db
    .select()
    .from(cases)
    .where(inArray(cases.id, caseIds))

  // Group cases by normalized category + subCategory
  type Group = {
    category: string
    subCategory: string
    unitType: 'per_tooth' | 'per_arch'
    totalUnits: number
  }
  const groupMap = new Map<string, Group>()

  for (const c of selectedCases) {
    const input = mapCaseToPricingInput(c.category || '', c.subTypeData)
    if (!input) continue

    // Implants are handled separately because they can produce two distinct
    // line items: one for the implant device component (Robotic/Ti-Base/Custom)
    // and one for the optional Crown/Bridge component, each counted by their
    // own tooth selection array.
    if (input.category === 'Implants') {
      const data = (c.subTypeData as Record<string, any>) || {}

      // 1. Implant device component (Robotic / Ti-Base / Custom)
      const implantCount = Array.isArray(data.teeth) ? (data.teeth as unknown[]).length : 0
      if (implantCount > 0) {
        const key = `Implants:${input.subCategory}`
        const g = groupMap.get(key)
        if (g) g.totalUnits += implantCount
        else groupMap.set(key, { category: 'Implants', subCategory: input.subCategory, unitType: 'per_tooth', totalUnits: implantCount })
      }

      // 2. Optional Crown / Bridge component — priced from Crown & Bridge catalog
      const cbType = data.caseType2 as string | undefined
      if (cbType && cbType !== 'None' && input.type) {
        const cbCount = Array.isArray(data.crownBridgeTeeth) ? (data.crownBridgeTeeth as unknown[]).length : 0
        if (cbCount > 0) {
          const key = `Crown & Bridge:${input.type}`
          const g = groupMap.get(key)
          if (g) g.totalUnits += cbCount
          else groupMap.set(key, { category: 'Crown & Bridge', subCategory: input.type, unitType: 'per_tooth', totalUnits: cbCount })
        }
      }

      continue // skip generic processing below
    }

    let category = input.category
    let subCategory: string
    let unitType: 'per_tooth' | 'per_arch' = 'per_tooth'

    if (input.category === 'Crown & Bridge') {
      subCategory = input.subCategory
      unitType = 'per_tooth'
    } else if (input.category === 'Appliances') {
      subCategory = input.applianceType
      unitType = 'per_arch'
    } else if (input.category === 'Dentures') {
      subCategory = input.subCategory
      unitType = 'per_arch'
    } else if (input.category === 'Cosmetics') {
      subCategory = input.subCategory
      unitType = 'per_arch'
    } else {
      continue
    }

    const key = `${category}:${subCategory}`
    const existing = groupMap.get(key)
    const units = extractUnitCount(unitType, c.subTypeData)

    if (existing) {
      existing.totalUnits += units
    } else {
      groupMap.set(key, { category, subCategory, unitType, totalUnits: units })
    }
  }

  // Resolve prices and build line items
  const items: InvoiceLineItem[] = []
  let subtotal = 0
  let sno = 1

  for (const group of groupMap.values()) {
    const unitPrice = await getUnitPrice(clientId, group.category, group.subCategory)
    const totalPrice = parseFloat((group.totalUnits * unitPrice).toFixed(2))
    subtotal += totalPrice

    items.push({
      sno: sno++,
      description: `${group.category} - ${group.subCategory}`,
      qty: group.totalUnits,
      unitPrice,
      totalPrice,
    })
  }

  // Model billing — count cases where modelRequired = "yes" (per_case charge)
  const modelCount = selectedCases.filter((c) => {
    const data = (c.subTypeData as Record<string, any>) || {}
    return data.modelRequired === 'yes'
  }).length

  if (modelCount > 0) {
    const modelUnitPrice = await getUnitPrice(clientId, 'Model', '3D Model')
    const modelTotalPrice = parseFloat((modelCount * modelUnitPrice).toFixed(2))
    subtotal += modelTotalPrice
    items.push({
      sno: sno++,
      description: 'Model - 3D Model',
      qty: modelCount,
      unitPrice: modelUnitPrice,
      totalPrice: modelTotalPrice,
    })
  }

  return { items, subtotal: parseFloat(subtotal.toFixed(2)) }
}

// ── Full invoice row with joined client profile ──────────────────────────────

export type InvoiceWithClient = {
  id: string
  invoiceNumber: string
  clientId: string
  clientName: string
  clientLabName: string | null
  clientEmail: string
  clientPhone: string | null
  clientCity: string | null
  clientState: string | null
  clientCountry: string | null
  clientPostalCode: string | null
  startDate: string
  endDate: string
  items: InvoiceLineItem[]
  caseIds: string[]
  subtotal: number
  taxType: string
  taxValue: number
  taxAmount: number
  discountType: string
  discountValue: number
  discountAmount: number
  extraChargesType: string
  extraChargesValue: number
  extraChargesAmount: number
  total: number
  status: string
  remarks: string | null
  termsOfPayment: string | null
  // Client payment tracking
  clientPaid: boolean
  clientPaymentDate: string | null
  // Admin receipt confirmation
  received: boolean
  receivedConfirmationId: string | null
  receivedOn: string | null
  createdAt: string
  updatedAt: string
}

export function formatInvoiceRow(
  inv: typeof invoices.$inferSelect,
  client: typeof profiles.$inferSelect
): InvoiceWithClient {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    clientId: inv.clientId,
    clientName: client.fullName ?? '',
    clientLabName: client.labName,
    clientEmail: client.email,
    clientPhone: client.phone,
    clientCity: client.city,
    clientState: client.state,
    clientCountry: client.country,
    clientPostalCode: client.postalCode,
    startDate: inv.startDate,
    endDate: inv.endDate,
    items: (inv.items as InvoiceLineItem[]) ?? [],
    caseIds: (inv.caseIds as string[]) ?? [],
    subtotal: parseFloat(String(inv.subtotal)),
    taxType: inv.taxType,
    taxValue: parseFloat(String(inv.taxValue)),
    taxAmount: parseFloat(String(inv.taxAmount)),
    discountType: inv.discountType,
    discountValue: parseFloat(String(inv.discountValue)),
    discountAmount: parseFloat(String(inv.discountAmount)),
    extraChargesType: inv.extraChargesType,
    extraChargesValue: parseFloat(String(inv.extraChargesValue)),
    extraChargesAmount: parseFloat(String(inv.extraChargesAmount)),
    total: parseFloat(String(inv.total)),
    status: inv.status,
    remarks: inv.remarks,
    termsOfPayment: inv.termsOfPayment ?? '7 Days',
    clientPaid: inv.clientPaid ?? false,
    clientPaymentDate: inv.clientPaymentDate ?? null,
    received: inv.received ?? false,
    receivedConfirmationId: inv.receivedConfirmationId ?? null,
    receivedOn: inv.receivedOn ?? null,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  }
}
