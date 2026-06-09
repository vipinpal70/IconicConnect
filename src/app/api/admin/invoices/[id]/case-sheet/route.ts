import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { invoices } from '@/src/db/schema/invoice'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { serviceCatalog, clientPriceList } from '@/src/db/schema/price-list'
import { eq, inArray } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'

// ── CSV helpers ────────────────────────────────────────────────────────────────

function cell(value: string | number | null | undefined): string {
  const s = String(value ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function row(...values: (string | number | null | undefined)[]): string {
  return values.map(cell).join(',')
}

// ── Price helpers ──────────────────────────────────────────────────────────────

function buildPriceMap(
  catalogItems: { category: string; subCategory: string; defaultPrice: string }[],
  clientPrices: { category: string; subCategory: string; price: string }[]
) {
  const def = new Map<string, number>()
  for (const c of catalogItems) def.set(`${c.category}:${c.subCategory}`, parseFloat(c.defaultPrice))

  const cli = new Map<string, number>()
  for (const c of clientPrices) cli.set(`${c.category}:${c.subCategory}`, parseFloat(c.price))

  return (cat: string, sub: string) =>
    cli.get(`${cat}:${sub}`) ?? def.get(`${cat}:${sub}`) ?? 0
}

// ── Per-case extraction ────────────────────────────────────────────────────────

type CaseRow = {
  caseNumber: string
  category: string
  subType: string
  selection: string
  units: number
  unitsLabel: string
  modelRequired: string
  unitPrice: number
  modelPrice: number
  caseTotal: number
}

function extractCaseRow(
  c: { caseNumber: string | null; category: string | null; subTypeData: unknown; clientId: string },
  getPrice: (cat: string, sub: string) => number
): CaseRow {
  const d = (c.subTypeData as Record<string, unknown>) ?? {}
  const cat = (c.category ?? '').toLowerCase().trim()
  const modelRequired = d.modelRequired === 'yes'
  const modelPrice = modelRequired ? getPrice('Model', '3D Model') : 0

  const archStr = String(d.arch || d.caseType2 || 'Upper').toLowerCase()
  const archCount = archStr.includes('both') || archStr.includes('full') ? 2 : 1

  let subType = '—'
  let selection = '—'
  let units = 0
  let unitPrice = 0
  let isArchBased = false

  if (cat === 'crown & bridge' || cat === 'crown & bridges') {
    subType = String(d.sub_category || d.subCategory || d.caseType || 'Crown')
    const teeth = Array.isArray(d.teeth) ? (d.teeth as number[]) : []
    selection = teeth.length ? teeth.map((t) => `#${t}`).join(', ') : '—'
    units = teeth.length
    unitPrice = getPrice('Crown & Bridge', subType)
  } else if (cat === 'implant' || cat === 'implants') {
    const implantSub = String(d.sub_category || d.subCategory || d.caseType1 || 'Ti-Base')
    const cbType = String(d.caseType2 || '')
    subType = cbType && cbType !== 'None' ? `${implantSub} - ${cbType}` : implantSub

    const impTeeth = Array.isArray(d.teeth) ? (d.teeth as number[]) : []
    const cbTeeth = Array.isArray(d.crownBridgeTeeth) ? (d.crownBridgeTeeth as number[]) : []
    const impParts = impTeeth.map((t) => `Imp:#${t}`)
    const cbParts = cbTeeth.map((t) => `CB:#${t}`)
    selection = [...impParts, ...cbParts].join(', ') || '—'
    units = impTeeth.length + cbTeeth.length
    const impPrice = impTeeth.length * getPrice('Implants', implantSub)
    const cbPrice = cbTeeth.length > 0 && cbType && cbType !== 'None'
      ? cbTeeth.length * getPrice('Crown & Bridge', cbType)
      : 0
    unitPrice = units > 0 ? parseFloat(((impPrice + cbPrice) / units).toFixed(2)) : 0
  } else if (cat === 'appliances' || cat === 'appliance') {
    subType = String(d.appliance_type || d.applianceType || d.caseType1 || 'Night Guards')
    selection = String(d.arch || d.caseType2 || 'Upper')
    units = archCount
    unitPrice = getPrice('Appliances', subType)
    isArchBased = true
  } else if (cat === 'denture' || cat === 'dentures') {
    subType = String(d.sub_category || d.subCategory || d.caseType1 || 'Full Denture')
    selection = String(d.arch || d.caseType2 || 'Upper')
    units = archCount
    unitPrice = getPrice('Dentures', subType)
    isArchBased = true
  } else if (cat === 'cosmetics' || cat === 'cosmetic') {
    subType = String(d.sub_category || d.subCategory || d.caseType || d.caseType1 || 'Veneers')
    selection = String(d.arch || d.caseType2 || 'Upper')
    units = archCount
    unitPrice = getPrice('Cosmetics', subType)
    isArchBased = true
  }

  const unitsLabel = isArchBased
    ? `${units} arch${units !== 1 ? 'es' : ''}`
    : `${units} unit${units !== 1 ? 's' : ''}`

  const caseTotal = parseFloat((units * unitPrice + modelPrice).toFixed(2))

  return {
    caseNumber: c.caseNumber ?? '—',
    category: c.category ?? '—',
    subType,
    selection,
    units,
    unitsLabel,
    modelRequired: modelRequired ? 'Yes' : 'No',
    unitPrice,
    modelPrice,
    caseTotal,
  }
}

// ── Route ──────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [adminProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!adminProfile || adminProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const [client] = await db.select().from(profiles).where(eq(profiles.id, inv.clientId)).limit(1)
    const clientName = client?.labName || client?.fullName || client?.email || '—'

    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const caseIds = (inv.caseIds as string[] | null) ?? []

    let csvLines: string[] = []

    // ── Header block ──
    csvLines.push(row('Invoice Number', inv.invoiceNumber))
    csvLines.push(row('Client', clientName))
    csvLines.push(row('Period', `${inv.startDate} to ${inv.endDate}`))
    csvLines.push(row('Generated', today))
    csvLines.push('')

    if (caseIds.length > 0) {
      // ── Per-case mode ──
      const [caseRows, catalogItems, clientPriceRows] = await Promise.all([
        db.select().from(cases).where(inArray(cases.id, caseIds)),
        db.select({
          category: serviceCatalog.category,
          subCategory: serviceCatalog.subCategory,
          defaultPrice: serviceCatalog.defaultPrice,
        }).from(serviceCatalog).where(eq(serviceCatalog.isActive, true)),
        db.select({
          category: serviceCatalog.category,
          subCategory: serviceCatalog.subCategory,
          price: clientPriceList.price,
        })
          .from(clientPriceList)
          .innerJoin(serviceCatalog, eq(clientPriceList.catalogItemId, serviceCatalog.id))
          .where(eq(clientPriceList.clientId, inv.clientId)),
      ])

      const getPrice = buildPriceMap(catalogItems, clientPriceRows)

      csvLines.push(row('Case Number', 'Category', 'Sub-Type', 'Teeth / Arch Selection', 'Units / Arches', 'Model Required', 'Unit Price ($)', 'Case Total ($)'))

      let grandTotal = 0
      for (const c of caseRows) {
        const r = extractCaseRow(
          { caseNumber: c.caseNumber, category: c.category, subTypeData: c.subTypeData, clientId: c.clientId },
          getPrice
        )
        csvLines.push(row(r.caseNumber, r.category, r.subType, r.selection, r.unitsLabel, r.modelRequired, r.unitPrice.toFixed(2), r.caseTotal.toFixed(2)))
        grandTotal += r.caseTotal
      }

      csvLines.push('')
      csvLines.push(row('', '', '', '', '', '', 'Grand Total', grandTotal.toFixed(2)))
    } else {
      // ── Fallback: aggregated items from invoice ──
      csvLines.push(row('Note: Individual case data not available for this invoice (older invoice format).'))
      csvLines.push('')
      csvLines.push(row('Service', 'Qty', 'Unit Price ($)', 'Total ($)'))
      const items = inv.items as Array<{ description: string; qty: number; unitPrice: number; totalPrice: number }> ?? []
      for (const item of items) {
        csvLines.push(row(item.description, item.qty, item.unitPrice.toFixed(2), item.totalPrice.toFixed(2)))
      }
      csvLines.push('')
      csvLines.push(row('', '', 'Subtotal', parseFloat(String(inv.subtotal)).toFixed(2)))
      csvLines.push(row('', '', 'Total', parseFloat(String(inv.total)).toFixed(2)))
    }

    const csv = csvLines.join('\n')
    const filename = `${inv.invoiceNumber}-case-sheet.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[admin/invoices/[id]/case-sheet GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
