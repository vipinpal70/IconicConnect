import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { subUsers } from '@/src/db/schema/profile'
import { serviceCatalog, clientPriceList } from '@/src/db/schema/price-list'

export interface PriceListEntryFull {
  id: string
  catalogItemId: string
  category: string
  subCategory: string
  unitType: 'per_tooth' | 'per_arch'
  defaultPrice: number
  price: number
  notes: string | null
  sortOrder: number
}

export async function resolveClientIdFromProfile(profileId: string, role: string) {
  if (role === 'client') return profileId
  if (role === 'subuser') {
    const [record] = await db.select().from(subUsers).where(eq(subUsers.profileId, profileId)).limit(1)
    return record?.clientId ?? null
  }
  return null
}

export async function getPriceListForClient(clientId: string, _autoSeed = true): Promise<PriceListEntryFull[]> {
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
    })
    .from(clientPriceList)
    .innerJoin(serviceCatalog, eq(clientPriceList.catalogItemId, serviceCatalog.id))
    .where(eq(clientPriceList.clientId, clientId))
    .orderBy(serviceCatalog.sortOrder)

  if (rows.length === 0 && _autoSeed) {
    await seedClientPriceList(clientId)
    return getPriceListForClient(clientId, false)
  }

  return rows.map((row) => ({
    ...row,
    defaultPrice: Number(row.defaultPrice),
    price: Number(row.price),
  }))
}

export async function getServiceCatalog(): Promise<PriceListEntryFull[]> {
  const rows = await db
    .select()
    .from(serviceCatalog)
    .where(eq(serviceCatalog.isActive, true))
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

export async function updateClientPriceList(
  clientId: string,
  items: Array<{ catalogItemId: string; price: number; notes?: string | null }>,
  createdById: string
) {
  if (items.length === 0) return []

  return await db.transaction(async (tx) => {
    const results = []
    for (const item of items) {
      const priceStr = Number(item.price).toFixed(2)

      const [row] = await tx
        .insert(clientPriceList)
        .values({
          clientId,
          catalogItemId: item.catalogItemId,
          price: priceStr,
          notes: item.notes?.trim() || null,
          createdBy: createdById,
        })
        .onConflictDoUpdate({
          target: [clientPriceList.clientId, clientPriceList.catalogItemId],
          set: {
            price: priceStr,
            notes: item.notes?.trim() || null,
            updatedAt: new Date(),
          },
        })
        .returning()

      if (row) results.push(row)
    }
    return results
  })
}
