# Price List Update Plan — Design vs Design+Milling

Decisions confirmed below. This is now an implementation plan, not a discovery doc — waiting for final go-ahead before touching code.

---

## Decisions made

1. **"PDF"** = the existing CSV case-sheet export (`case-sheet/route.ts`). No new PDF library. Just fix its pricing bug and add a Service Type column.
2. **One unified table**, everywhere a price list is shown:
   `Service | Unit | Default Design Price | Default D+Milling Price | Client Design Price | Client D+Milling Price`
3. **Per-client pricing lives on the Admin Client Detail page** (`/admin/clients/[id]`), same single-table pattern that existed before milling was split out — no tabs.
4. **`/admin/milling/pricing` is removed entirely** — editable table *and* the partner-rate/margin reference cards. Editing Design+Milling *default* prices moves into the Admin Profile page's "Default Price List" section, alongside the existing Design defaults — one table, two editable price columns.
5. **Hard refresh** — `?refresh=true` bypasses Redis, reads DB directly, then re-populates (write-through) the same Redis key. No separate CDN exists in this app (confirmed: no `revalidateTag`/edge caching anywhere in the repo) — "CDN" in the original notes maps to Redis + the browser session/local-storage cache in `price-list-cache.ts`; hard refresh clears/repopulates both.

One assumption I'm making, flag if wrong: on the **client's own** profile page (`ClientPriceListModal`), I'll show just their two price columns (Client Design Price / Client D+Milling Price), read-only — no Default columns, since defaults aren't meaningful to them. Everything admin-facing gets all 4 columns.

---

## Confirmed bugs to fix (independent of the UI work)

- `src/app/api/billing/clients/[clientId]/route.ts` — `buildPriceMap()` keys by `category:subCategory` only. Since `service_catalog` has two rows per category/subCategory (one per `serviceType`), this collides and can price Design+Milling cases using the wrong row. Fix: key by `category:subCategory:serviceType`, read `case.serviceType` per case (default `design_only` for legacy rows).
- `src/app/api/admin/invoices/[id]/case-sheet/route.ts` (the CSV export) — identical bug, same fix, plus add a "Service Type" column to the CSV.
- Note: `src/lib/invoice.ts` (`getUnitPrice`, `buildInvoiceItems` — the actual "Generate Invoice" path) is already correct. Not touched.

---

## Implementation steps

### 1. `src/lib/price-list.ts` — add a merge helper
New exported type + function, used by every UI below instead of each page re-merging two fetches by hand:
```ts
export interface MergedPriceRow {
  category: string
  subCategory: string
  unitType: 'per_tooth' | 'per_arch' | 'per_case'
  sortOrder: number
  designOnly: { catalogItemId: string; defaultPrice: number; price: number } | null
  designMilling: { catalogItemId: string; defaultPrice: number; price: number } | null
}
export function mergeByServiceType(designOnly: PriceListEntryFull[], designMilling: PriceListEntryFull[]): MergedPriceRow[]
```
Merges by `category + subCategory`, sorted by `sortOrder`.

### 2. `PriceListTable.tsx` — rework to render merged rows
Replace the single-price-column table with a configurable one: still one `<table>` per category group, but columns driven by which of `defaultDesign` / `defaultMilling` / `clientDesign` / `clientMilling` are passed in and whether each is editable. Row identity for edits is per-serviceType `catalogItemId` (a row's Design and D+Milling cells edit two different catalog rows under the hood, transparently). Existing 2-column callers (none will remain after step 3-5, but keeping the component backward-compatible isn't worth the complexity — all 4 call sites are being rewritten in this change) get updated in the same pass.

`ClientPriceListModal.tsx` — passes through to the reworked table, read-only, Client Design + Client D+Milling columns only (per the assumption above).

### 3. Admin Profile page (`/admin/profile`) — Default Price List
- Fetch both `/api/admin/service-catalog?serviceType=design_only` and `?serviceType=design_milling`, merge with `mergeByServiceType`.
- Table: Service | Unit | Default Design Price (editable) | Default D+Milling Price (editable).
- Save: PUT `/api/admin/service-catalog` with the combined changed items from both columns (route already saves by catalog `id` regardless of type — no backend change needed here).
- Add "Refresh from DB" button → calls both GETs with `?refresh=true`.

### 4. `/api/admin/service-catalog` route — add hard refresh
- GET: accept `?refresh=true`; when set, skip any cache read (currently this route doesn't cache reads at all — confirm during implementation whether to add read-caching here for consistency, or leave uncached and only add the flag for symmetry/future-proofing).

### 5. Admin Client Detail page (`/admin/clients/[id]`) — Allocated Price List
- Fetch client price list for both service types + catalog defaults for both, merge with `mergeByServiceType`.
- Table: Service | Unit | Default Design Price (ref) | Default D+Milling Price (ref) | Client Design Price (editable) | Client D+Milling Price (editable).
- Save: PUT `/api/admin/clients/[id]/price-list` with combined changed items across both service types (works today — `updateClientPriceList` upserts by `catalogItemId`, type-agnostic).
- Add "Refresh from DB" button.

### 6. `/api/admin/clients/[id]/price-list` route
- GET: add `?refresh=true` bypass (this route currently has no caching at all on GET — add read-through Redis caching here too, since the client-facing route already caches the same data and currently the two can disagree).
- PUT: fix the bug where it always re-reads with the default `design_only` serviceType after saving — return both service types merged instead. Invalidate **both** `price-list:client:${id}:design_only` and `price-list:client:${id}:design_milling` Redis keys (not just the single untyped key it deletes today).

### 7. `/api/client/price-list` route + `price-list-cache.ts`
- GET: accept `?serviceType=`, default `design_only`. Cache key becomes `price-list:client:${clientId}:${serviceType}`.
- Add `?refresh=true` bypass, same write-through pattern.
- `price-list-cache.ts`: namespace `sessionStorage`/`localStorage` keys by serviceType; `fetchPriceListWithCache(profileId, serviceType)`.
- Client profile page: fetch both service types, merge, render read-only per the assumption above.

### 8. Remove partner-rate / margin tracking from admin entirely
Confirmed: since Design and Design+Milling prices are both set directly (system default + per-client override), there's no computed markup anywhere — partner-rate/margin was only ever an optional cost-reference layer, and it's not needed. Removing every admin-facing trace of it, not just the Pricing page:

- **`/admin/milling/pricing/page.tsx`** — deleted (no editable table, moved to Admin Profile step 3; no reference cards, dropped).
- **`MillingSubNav.tsx`** — remove the `Pricing` tab entry.
- **`admin/(dashboard)/billing/[id]/page.tsx`** — remove the entire "Milling Cost Reference — Admin Only" block (lines ~433–480: the `millingPartnerRates` state, its fetch effect, and the client-price/partner-rate/margin table). The rest of the invoice detail page is untouched.
- **`admin/(dashboard)/milling/analytics/page.tsx`** — remove the "Gross margin" KPI card and the "Revenue vs partner cost" chart card. Keep "Revenue" KPI (now just `customerRevenue`, no cost figure alongside it), "Avg TAT", "Active cases", "Cases by centre", "Avg TAT by centre", "Product mix", and the "Design + Milling price list snapshot" card — those aren't margin/cost data.
- **`/api/admin/milling/analytics/route.ts`** — stop computing `partnerCost`/`margin`; compute `customerRevenue` directly via `getUnitPrice(..., 'design_milling')` instead of going through `getMillingMargin()`.
- **`src/lib/milling/pricing-engine.ts`** (`getMillingMargin`) — becomes fully unused once the above two land → delete the file.
- **`GET /api/admin/milling/service-catalog`** (raw partner-rate list) — becomes fully unused once the Pricing page and the invoice-detail block are gone → delete the route.

**Also removed (confirmed):** the milling centre's own self-service catalog/rate entry — milling centres get no pricing or service-catalog input at all now, admin-managed only.
- **`src/app/milling/(dashboard)/services/page.tsx`** — deleted.
- **`src/app/api/milling/services/route.ts`** and **`src/app/api/milling/services/[id]/route.ts`** — deleted.
- **`MillingSidebar.tsx`** — remove the `{ title: "Services", url: "/milling/services", icon: Wrench }` nav entry.
- Checked for blast radius: `src/lib/milling/routing-engine.ts` (case-assignment routing) does **not** read `millingServiceCatalog` at all, so removing this doesn't affect routing/assignment. The only other references were the two files already being deleted above (`pricing-engine.ts`, `api/admin/milling/service-catalog/route.ts`).
- **`millingServiceCatalog` table** (`src/db/schema/milling.ts`) — once all of the above lands, nothing in the app reads or writes it. I'm treating dropping the table itself as a separate call: I can (a) leave the schema/table in place but fully unused, cheap to drop later, zero risk, or (b) write a migration to drop it outright for a clean removal. Defaulting to **(a)** unless you tell me to drop it — it's a schema change with no way to undo without a backup, and doesn't block anything else in this plan.

### 9. Bug fixes — billing + case sheet (from the confirmed-bugs section)
- `src/app/api/billing/clients/[clientId]/route.ts`: fix `buildPriceMap`/`computeCasePrice` to key on `category:subCategory:serviceType`, pass `c.serviceType` through.
- `src/app/api/admin/invoices/[id]/case-sheet/route.ts`: same fix, add "Service Type" CSV column.
- `src/app/admin/(dashboard)/billing/page.tsx`: add a Service Type column/badge (same `Factory` icon treatment as the Cases page) to the case-selection table, so admin can see which cases in the picker are Design+Milling before generating an invoice.

---

## Files touched (summary)

**New logic:** `src/lib/price-list.ts` (merge helper)
**Rewritten UI:** `PriceListTable.tsx`, `ClientPriceListModal.tsx`, `admin/(dashboard)/profile/page.tsx`, `admin/(dashboard)/clients/[id]/page.tsx`, `client/(dashboard)/profile/page.tsx`, `admin/(dashboard)/billing/page.tsx` (badge only), `admin/(dashboard)/billing/[id]/page.tsx` (remove cost-reference block), `admin/(dashboard)/milling/analytics/page.tsx` (remove margin KPI/chart)
**Deleted:** `admin/(dashboard)/milling/pricing/page.tsx`, its `MillingSubNav.tsx` entry, `api/admin/milling/service-catalog/route.ts`, `src/lib/milling/pricing-engine.ts`, `src/app/milling/(dashboard)/services/page.tsx`, `src/app/api/milling/services/route.ts`, `src/app/api/milling/services/[id]/route.ts`, `MillingSidebar.tsx`'s Services entry
**API changes:** `api/admin/service-catalog/route.ts`, `api/admin/clients/[id]/price-list/route.ts`, `api/client/price-list/route.ts`, `api/billing/clients/[clientId]/route.ts`, `api/admin/invoices/[id]/case-sheet/route.ts`, `api/admin/milling/analytics/route.ts`
**Cache:** `price-list-cache.ts`

No schema/migration changes — everything needed (`service_type` columns, seeding of both types per client) is already in place.

---

Ready to implement on your go-ahead.