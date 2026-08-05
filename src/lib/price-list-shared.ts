// Client-safe price list types + helpers — NO imports from '@/src/db' or any
// server-only module here. Client components ("use client") that need
// MergedPriceRow / mergeByServiceType must import from THIS file, not from
// './price-list', because a value import of anything from './price-list'
// pulls its `db` (postgres/drizzle) import chain into the browser bundle —
// which breaks the build (postgres uses Node builtins: fs, net, tls,
// perf_hooks, none of which exist in the browser).

export interface PriceListEntryFull {
  id: string
  catalogItemId: string
  category: string
  subCategory: string
  unitType: 'per_tooth' | 'per_arch' | 'per_case'
  defaultPrice: number
  price: number
  notes: string | null
  sortOrder: number
  // System-level enable state (serviceCatalog.isActive).
  isActive: boolean
  // Client-level override (clientPriceList.isEnabled) — only meaningful on
  // rows from getPriceListForClient; defaults to true on catalog-only rows.
  isEnabled: boolean
}

// ── Merged Design / Design+Milling / Milling Only rows ──────────────────────
// All three service types share the same category/subCategory grouping (see
// the pricing architecture note in milling-implementation-plan.md) — this
// merges up to three per-serviceType fetches into one row per service, for
// display in a single table with a column per flow.

export interface MergedPriceRowSide {
  catalogItemId: string
  defaultPrice: number
  price: number
  notes: string | null
  isActive: boolean
  isEnabled: boolean
}

export interface MergedPriceRow {
  category: string
  subCategory: string
  unitType: 'per_tooth' | 'per_arch' | 'per_case'
  sortOrder: number
  designOnly: MergedPriceRowSide | null
  designMilling: MergedPriceRowSide | null
  millingOnly: MergedPriceRowSide | null
}

function toSide(row: PriceListEntryFull): MergedPriceRowSide {
  return {
    catalogItemId: row.catalogItemId,
    defaultPrice: row.defaultPrice,
    price: row.price,
    notes: row.notes,
    isActive: row.isActive,
    isEnabled: row.isEnabled,
  }
}

export function mergeByServiceType(
  designOnly: PriceListEntryFull[],
  designMilling: PriceListEntryFull[],
  millingOnly: PriceListEntryFull[] = []
): MergedPriceRow[] {
  const key = (category: string, subCategory: string) => `${category}::${subCategory}`
  const map = new Map<string, MergedPriceRow>()

  const upsert = (row: PriceListEntryFull, side: 'designOnly' | 'designMilling' | 'millingOnly') => {
    const k = key(row.category, row.subCategory)
    const existing = map.get(k)
    if (existing) {
      existing[side] = toSide(row)
    } else {
      map.set(k, {
        category: row.category,
        subCategory: row.subCategory,
        unitType: row.unitType,
        sortOrder: row.sortOrder,
        designOnly: null,
        designMilling: null,
        millingOnly: null,
        [side]: toSide(row),
      })
    }
  }

  for (const row of designOnly) upsert(row, 'designOnly')
  for (const row of designMilling) upsert(row, 'designMilling')
  for (const row of millingOnly) upsert(row, 'millingOnly')

  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder)
}
