/**
 * src/app/api/billing/clients/[clientId]/route.ts
 * Purpose: Returns client details, case list with calculated prices, and total price.
 * Pricing: client price list first, fallback to service catalog default.
 *          Per-unit (per tooth or per arch) as per billing_price_calculation.md
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { cases, caseFiles } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { serviceCatalog, clientPriceList } from '@/src/db/schema/price-list'
import { eq, and, gte, lte, inArray, asc } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'

// ── Price map helpers ──────────────────────────────────────────────────────────

function buildPriceMap(
  catalogItems: { category: string; subCategory: string; defaultPrice: string }[],
  clientPrices: { category: string; subCategory: string; price: string }[]
) {
  const defaultMap = new Map<string, number>()
  for (const item of catalogItems) {
    defaultMap.set(`${item.category}:${item.subCategory}`, parseFloat(item.defaultPrice))
  }

  const clientMap = new Map<string, number>()
  for (const cp of clientPrices) {
    clientMap.set(`${cp.category}:${cp.subCategory}`, parseFloat(cp.price))
  }

  return (category: string, subCategory: string): number =>
    clientMap.get(`${category}:${subCategory}`) ??
    defaultMap.get(`${category}:${subCategory}`) ??
    0
}

// ── Per-case price calculation ─────────────────────────────────────────────────

function computeCasePrice(
  category: string | null,
  subTypeData: unknown,
  getPrice: (cat: string, sub: string) => number
): number {
  const data = (subTypeData as Record<string, unknown>) || {}
  const cat = (category || '').toLowerCase().trim()

  const archCount = (() => {
    const arch = String(data.arch || data.caseType2 || 'Upper').toLowerCase()
    return arch.includes('both') || arch.includes('full') ? 2 : 1
  })()

  // Crown & Bridge
  if (cat === 'crown & bridge' || cat === 'crown & bridges') {
    const subCat = String(data.sub_category || data.subCategory || data.caseType || 'Crown')
    const teeth = Array.isArray(data.teeth) ? (data.teeth as unknown[]).length : 0
    let price = teeth * getPrice('Crown & Bridge', subCat)

    // Model
    if (data.modelRequired === 'yes') price += getPrice('Model', '3D Model')
    return parseFloat(price.toFixed(2))
  }

  // Implant
  if (cat === 'implant' || cat === 'implants') {
    const implantSubCat = String(data.sub_category || data.subCategory || data.caseType1 || 'Ti-Base')
    const cbType = String(data.caseType2 || '')

    const implantTeeth = Array.isArray(data.teeth) ? (data.teeth as unknown[]).length : 0
    const cbTeeth = Array.isArray(data.crownBridgeTeeth) ? (data.crownBridgeTeeth as unknown[]).length : 0

    let price = implantTeeth * getPrice('Implants', implantSubCat)
    if (cbTeeth > 0 && cbType && cbType !== 'None') {
      price += cbTeeth * getPrice('Crown & Bridge', cbType)
    }

    if (data.modelRequired === 'yes') price += getPrice('Model', '3D Model')
    return parseFloat(price.toFixed(2))
  }

  // Appliances
  if (cat === 'appliances' || cat === 'appliance') {
    const appType = String(data.appliance_type || data.applianceType || data.caseType1 || 'Night Guards')
    let price = archCount * getPrice('Appliances', appType)
    if (data.modelRequired === 'yes') price += getPrice('Model', '3D Model')
    return parseFloat(price.toFixed(2))
  }

  // Dentures
  if (cat === 'denture' || cat === 'dentures') {
    const subCat = String(data.sub_category || data.subCategory || data.caseType1 || 'Full Denture')
    let price = archCount * getPrice('Dentures', subCat)
    if (data.modelRequired === 'yes') price += getPrice('Model', '3D Model')
    return parseFloat(price.toFixed(2))
  }

  // Cosmetics
  if (cat === 'cosmetics' || cat === 'cosmetic') {
    const subCat = String(data.sub_category || data.subCategory || data.caseType || data.caseType1 || 'Veneers')
    let price = archCount * getPrice('Cosmetics', subCat)
    if (data.modelRequired === 'yes') price += getPrice('Model', '3D Model')
    return parseFloat(price.toFixed(2))
  }

  return 0
}

// ── Route ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params
    const { searchParams } = new URL(req.url)
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [adminProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!adminProfile || adminProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Client profile
    let clientProfile = null
    if (clientId !== 'all') {
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1)
      if (!profile) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      clientProfile = profile
    }

    // Build query conditions
    const conditions = []
    if (clientId !== 'all') conditions.push(eq(cases.clientId, clientId))
    if (startDateParam) {
      const start = new Date(startDateParam)
      start.setHours(0, 0, 0, 0)
      conditions.push(gte(cases.createdAt, start))
    }
    if (endDateParam) {
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      conditions.push(lte(cases.createdAt, end))
    }

    const clientCases = await db.select()
      .from(cases)
      .where(and(...conditions))
      .orderBy(cases.createdAt)

    // Load service catalog + client price list in one batch
    const [catalogItems, clientPriceRows] = await Promise.all([
      db.select({
        category: serviceCatalog.category,
        subCategory: serviceCatalog.subCategory,
        defaultPrice: serviceCatalog.defaultPrice,
      }).from(serviceCatalog).where(eq(serviceCatalog.isActive, true)),

      clientId !== 'all'
        ? db.select({
            category: serviceCatalog.category,
            subCategory: serviceCatalog.subCategory,
            price: clientPriceList.price,
          })
          .from(clientPriceList)
          .innerJoin(serviceCatalog, eq(clientPriceList.catalogItemId, serviceCatalog.id))
          .where(eq(clientPriceList.clientId, clientId))
        : Promise.resolve([]),
    ])

    const getPrice = buildPriceMap(catalogItems, clientPriceRows)

    // Fetch first uploaded scan file name for each case in one batch query
    const caseIdList = clientCases.map(c => c.id)
    const scanFileMap = new Map<string, string>()
    if (caseIdList.length > 0) {
      const fileRows = await db
        .select({ caseId: caseFiles.caseId, fileName: caseFiles.fileName })
        .from(caseFiles)
        .where(inArray(caseFiles.caseId, caseIdList))
        .orderBy(asc(caseFiles.createdAt))
      for (const row of fileRows) {
        if (row.caseId && !scanFileMap.has(row.caseId)) {
          scanFileMap.set(row.caseId, row.fileName)
        }
      }
    }

    let totalPrice = 0
    const detailedCases = clientCases.map(c => {
      const price = computeCasePrice(c.category, c.subTypeData, getPrice)
      totalPrice += price
      return {
        id: c.id,
        caseNumber: c.caseNumber,
        category: c.category,
        subTypeData: c.subTypeData,
        status: c.status,
        createdAt: c.createdAt,
        dueDate: c.dueDate,
        price,
        scanFileName: scanFileMap.get(c.id) ?? null,
      }
    })

    return NextResponse.json({
      client: clientProfile
        ? {
            id: clientProfile.id,
            fullName: clientProfile.fullName,
            labName: clientProfile.labName,
            email: clientProfile.email,
            phone: clientProfile.phone,
            city: clientProfile.city,
            state: clientProfile.state,
            postalCode: clientProfile.postalCode,
            country: clientProfile.country,
          }
        : { id: 'all', fullName: 'All Clients', labName: 'All Clients', email: '', phone: '', city: '', state: '', postalCode: '', country: '' },
      cases: detailedCases,
      totalPrice: parseFloat(totalPrice.toFixed(2)),
    })
  } catch (err) {
    console.error('[api/billing/clients/[clientId] GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
