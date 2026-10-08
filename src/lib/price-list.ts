import { and, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { subUsers } from '@/src/db/schema/profile'
import { serviceCatalog, clientPriceList } from '@/src/db/schema/price-list'

// Server-only module (imports '@/src/db'). Client-safe types/helpers
// (PriceListEntryFull) live in
// './price-list-shared' and are re-exported here for server-side
// convenience — "use client" components must import them directly from
// './price-list-shared' instead, never from this file, or the bundler
// will pull the postgres/drizzle db chain into the browser bundle.
export * from './price-list-shared'
import type { PriceListEntryFull } from './price-list-shared'
import { DEFAULT_CATALOG_ITEMS } from './default-catalog'

export async function resolveClientIdFromProfile(profileId: string, role: string) {
  if (role === 'client') return profileId
  if (role === 'subuser') {
    const [record] = await db.select().from(subUsers).where(eq(subUsers.profileId, profileId)).limit(1)
    return record?.clientId ?? null
  }
  return null
}

export async function getPriceListForClient(
  clientId: string,
  includeInactive = false
): Promise<PriceListEntryFull[]> {
  // Always ensure every active catalog item has a row for this client.
  // onConflictDoNothing means existing custom prices are never overwritten.
  // seedClientPriceList reconciles the system catalog first (see its own
  // ensureServiceCatalogSeeded() call), so a client price list fetched
  // without ever hitting getServiceCatalog still picks up new catalog items.
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
  includeInactive = false
): Promise<PriceListEntryFull[]> {
  // Reconcile any catalog items added to defaultItems since this DB was last
  // seeded — same "seed on read" pattern getPriceListForClient already uses
  // for seedClientPriceList below.
  await ensureServiceCatalogSeeded()

  const rows = await db
    .select()
    .from(serviceCatalog)
    .where(
      and(
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
  await ensureServiceCatalogSeeded()

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

// Reconciles the service_catalog table against `defaultItems` below — safe to
// call on every request, not just once from empty. Uses onConflictDoNothing
// keyed on (category, subCategory), so existing rows (including
// admin-edited prices) are never touched; only rows for *new* items added to
// this list in a later release get inserted. This is what makes adding a new
// category/sub-category here alone enough — no separate one-off backfill
// script is needed for plain catalog-row additions going forward (see
// 3d-model-implement-plan.md — the "3D Model" rows below originally required
// scripts/seed-3d-model-catalog.mjs to run manually because this function
// used to bail out early once the table was non-empty).
export async function ensureServiceCatalogSeeded() {
  // Seed default catalog items (23 original + additions since)
  const defaultItems = DEFAULT_CATALOG_ITEMS

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
