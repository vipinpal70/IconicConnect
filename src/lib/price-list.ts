import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, subUsers } from '@/src/db/schema/profile'
import { serviceCatalog, clientPriceList } from '@/src/db/schema/price-list'
import type { ServiceType } from './case-status-mapping'

// Server-only module (imports '@/src/db'). Client-safe types/helpers
// (PriceListEntryFull, MergedPriceRow, mergeByServiceType) live in
// './price-list-shared' and are re-exported here for server-side
// convenience — "use client" components must import them directly from
// './price-list-shared' instead, never from this file, or the bundler
// will pull the postgres/drizzle db chain into the browser bundle.
export * from './price-list-shared'
import type { PriceListEntryFull } from './price-list-shared'

export async function resolveClientIdFromProfile(profileId: string, role: string) {
  if (role === 'client') return profileId
  if (role === 'subuser') {
    const [record] = await db.select().from(subUsers).where(eq(subUsers.profileId, profileId)).limit(1)
    return record?.clientId ?? null
  }
  return null
}

export type CatalogServiceType = 'design_only' | 'design_milling' | 'milling_only'

export function parseCatalogServiceType(value: string | null): CatalogServiceType {
  return value === 'design_milling' || value === 'milling_only' ? value : 'design_only'
}

export async function getPriceListForClient(
  clientId: string,
  serviceType: CatalogServiceType = 'design_only',
  includeInactive = false
): Promise<PriceListEntryFull[]> {
  // Always ensure every active catalog item has a row for this client.
  // onConflictDoNothing means existing custom prices are never overwritten.
  await seedClientPriceList(clientId)

  const rows = await db
    .select({
      id: clientPriceList.id,
      catalogItemId: clientPriceList.catalogItemId,
      category: serviceCatalog.category,
      subCategory: serviceCatalog.subCategory,
      unitType: serviceCatalog.unitType,
      defaultPrice: serviceCatalog.defaultPrice,
      price: clientPriceList.price,
      notes: clientPriceList.notes,
      sortOrder: serviceCatalog.sortOrder,
      isActive: serviceCatalog.isActive,
      isEnabled: clientPriceList.isEnabled,
    })
    .from(clientPriceList)
    .innerJoin(serviceCatalog, eq(clientPriceList.catalogItemId, serviceCatalog.id))
    .where(
      and(
        eq(clientPriceList.clientId, clientId),
        eq(serviceCatalog.serviceType, serviceType),
        includeInactive ? undefined : eq(serviceCatalog.isActive, true)
      )
    )
    .orderBy(serviceCatalog.sortOrder)

  return rows.map((row) => ({
    ...row,
    defaultPrice: Number(row.defaultPrice),
    price: Number(row.price),
  }))
}

export async function getServiceCatalog(
  serviceType: CatalogServiceType = 'design_only',
  includeInactive = false
): Promise<PriceListEntryFull[]> {
  const rows = await db
    .select()
    .from(serviceCatalog)
    .where(
      and(
        eq(serviceCatalog.serviceType, serviceType),
        includeInactive ? undefined : eq(serviceCatalog.isActive, true)
      )
    )
    .orderBy(serviceCatalog.sortOrder)

  return rows.map((row) => ({
    id: row.id,
    catalogItemId: row.id,
    category: row.category,
    subCategory: row.subCategory,
    unitType: row.unitType,
    defaultPrice: Number(row.defaultPrice),
    price: Number(row.defaultPrice),
    notes: null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    isEnabled: true,
  }))
}

export async function seedClientPriceList(clientId: string, createdById?: string | null) {
  const catalog = await db
    .select()
    .from(serviceCatalog)
    .where(eq(serviceCatalog.isActive, true))
    .orderBy(serviceCatalog.sortOrder)

  if (catalog.length === 0) return

  await db
    .insert(clientPriceList)
    .values(
      catalog.map((item) => ({
        clientId,
        catalogItemId: item.id,
        price: item.defaultPrice,
        createdBy: createdById ?? null,
      }))
    )
    .onConflictDoNothing()
}

export async function updateCatalogDefaultPrices(
  items: Array<{ id: string; defaultPrice: number }>
) {
  if (items.length === 0) return

  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(serviceCatalog)
        .set({
          defaultPrice: Number(item.defaultPrice).toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(serviceCatalog.id, item.id))
    }
  })
}

export async function updateCatalogActiveStatus(
  items: Array<{ id: string; isActive: boolean }>
) {
  if (items.length === 0) return

  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(serviceCatalog)
        .set({
          isActive: item.isActive,
          updatedAt: new Date(),
        })
        .where(eq(serviceCatalog.id, item.id))
    }
  })
}

export async function updateClientPriceList(
  clientId: string,
  items: Array<{ catalogItemId: string; price: number; notes?: string | null; isEnabled?: boolean }>,
  createdById: string
) {
  if (items.length === 0) return []

  return await db.transaction(async (tx) => {
    const results = []
    for (const item of items) {
      const priceStr = Number(item.price).toFixed(2)
      const isEnabled = item.isEnabled ?? true

      const [row] = await tx
        .insert(clientPriceList)
        .values({
          clientId,
          catalogItemId: item.catalogItemId,
          price: priceStr,
          notes: item.notes?.trim() || null,
          isEnabled,
          createdBy: createdById,
        })
        .onConflictDoUpdate({
          target: [clientPriceList.clientId, clientPriceList.catalogItemId],
          set: {
            price: priceStr,
            notes: item.notes?.trim() || null,
            ...(item.isEnabled !== undefined ? { isEnabled: item.isEnabled } : {}),
            updatedAt: new Date(),
          },
        })
        .returning()

      if (row) results.push(row)
    }
    return results
  })
}

export async function getClientEnabledServiceTypes(clientId: string): Promise<ServiceType[]> {
  const [row] = await db
    .select({ enabledServiceTypes: profiles.enabledServiceTypes })
    .from(profiles)
    .where(eq(profiles.id, clientId))
    .limit(1)

  return (row?.enabledServiceTypes ?? ['design_only']) as ServiceType[]
}

export async function setClientEnabledServiceTypes(clientId: string, types: ServiceType[]) {
  if (types.length === 0) {
    throw new Error('A client must have at least one enabled service type')
  }

  await db
    .update(profiles)
    .set({ enabledServiceTypes: types, updatedAt: new Date() })
    .where(eq(profiles.id, clientId))
}

export async function ensureServiceCatalogSeeded() {
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceCatalog)
  
  if (countResult[0]?.count > 0) {
    return
  }

  // Seed default catalog items (23 items total)
  const defaultItems = [
    { category: 'Crown & Bridge', subCategory: 'Crown', unitType: 'per_tooth' as const, defaultPrice: '4.00', sortOrder: 1 },
    { category: 'Crown & Bridge', subCategory: 'Bridge', unitType: 'per_tooth' as const, defaultPrice: '5.00', sortOrder: 2 },
    { category: 'Crown & Bridge', subCategory: 'Cutback', unitType: 'per_tooth' as const, defaultPrice: '5.00', sortOrder: 3 },
    { category: 'Crown & Bridge', subCategory: 'Coping', unitType: 'per_tooth' as const, defaultPrice: '5.00', sortOrder: 4 },
    { category: 'Crown & Bridge', subCategory: 'Screw Retained', unitType: 'per_tooth' as const, defaultPrice: '10.00', sortOrder: 5 },
    { category: 'Crown & Bridge', subCategory: 'In-Lay', unitType: 'per_tooth' as const, defaultPrice: '15.00', sortOrder: 6 },
    { category: 'Crown & Bridge', subCategory: 'On-Lay', unitType: 'per_tooth' as const, defaultPrice: '20.00', sortOrder: 7 },
    { category: 'Implants', subCategory: 'Robotic', unitType: 'per_tooth' as const, defaultPrice: '4.00', sortOrder: 8 },
    { category: 'Implants', subCategory: 'Ti-Base', unitType: 'per_tooth' as const, defaultPrice: '4.00', sortOrder: 9 },
    { category: 'Implants', subCategory: 'Custom', unitType: 'per_tooth' as const, defaultPrice: '4.00', sortOrder: 10 },
    { category: 'Appliances', subCategory: 'Night Guards', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 11 },
    { category: 'Appliances', subCategory: 'Spot Guards', unitType: 'per_arch' as const, defaultPrice: '20.00', sortOrder: 12 },
    { category: 'Appliances', subCategory: 'Mouth Guards', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 13 },
    { category: 'Appliances', subCategory: 'NTI', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 14 },
    { category: 'Dentures', subCategory: 'Reference Denture', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 15 },
    { category: 'Dentures', subCategory: 'Copy Denture', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 16 },
    { category: 'Dentures', subCategory: 'Immediate Denture', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 17 },
    { category: 'Dentures', subCategory: 'Full Denture', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 18 },
    { category: 'Dentures', subCategory: 'Partial Denture', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 19 },
    { category: 'Cosmetics', subCategory: 'Digital Wax Up', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 20 },
    { category: 'Cosmetics', subCategory: 'Veneers', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 21 },
    { category: 'Cosmetics', subCategory: 'Snap on Smile', unitType: 'per_arch' as const, defaultPrice: '15.00', sortOrder: 22 },
    { category: 'Model', subCategory: '3D Model', unitType: 'per_case' as const, defaultPrice: '4.00', sortOrder: 23 },
    { category: '3D Model', subCategory: 'Full Arch Model', unitType: 'per_case' as const, defaultPrice: '3.50', sortOrder: 24 },
    { category: '3D Model', subCategory: 'Quad Model', unitType: 'per_case' as const, defaultPrice: '3.50', sortOrder: 25 },
    { category: '3D Model', subCategory: 'Contact Model', unitType: 'per_case' as const, defaultPrice: '3.50', sortOrder: 26 },
    { category: '3D Model', subCategory: 'Horse Shoe Model', unitType: 'per_case' as const, defaultPrice: '3.50', sortOrder: 27 },
    { category: '3D Model', subCategory: 'Implant Model', unitType: 'per_case' as const, defaultPrice: '3.50', sortOrder: 28 },
    { category: '3D Model', subCategory: 'Die', unitType: 'per_tooth' as const, defaultPrice: '0.50', sortOrder: 29 },
    { category: '3D Model', subCategory: 'Articulator', unitType: 'per_case' as const, defaultPrice: '0.50', sortOrder: 30 },
    { category: '3D Model', subCategory: 'Drain Holes', unitType: 'per_case' as const, defaultPrice: '0.00', sortOrder: 31 },
  ]

  await db
    .insert(serviceCatalog)
    .values(defaultItems)
    .onConflictDoNothing()
}

export async function handleProfileCreated(profileId: string, role: string, createdById?: string | null) {
  // Ensure the default price list is populated
  await ensureServiceCatalogSeeded()

  // For client profiles, automatically seed the allocated client price list
  if (role === 'client') {
    await seedClientPriceList(profileId, createdById)
  }
}
