// Client-safe price list types + helpers — NO imports from '@/src/db' or any
// server-only module here. Client components ("use client") that need
// PriceListEntryFull must import from THIS file, not from
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
