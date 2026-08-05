# Service Catalog Management Plan — 3 Flows (Design Only / Design+Milling / Milling Only)

Confirmed scope (from discussion):

1. **Milling Only becomes a real third case flow**, alongside `design_only` and `design_milling`. The client uploads an already-designed/manufacture-ready file, Iconic does no design work, verifies the file, and routes straight to a milling centre.
2. **Enable/disable + pricing exists at two levels**, for all three flows:
   - **System default** — admin turns a service on/off and sets its default price, globally.
   - **Client override** — admin turns a service on/off and sets its price for one specific client.
3. **A client can have any combination of the 3 flows enabled** on their account (admin-toggled, not one-flow-per-client). New clients default to Design Only enabled.
4. **Client pricing visibility** is gated by their enabled flows — they only ever see price columns/tabs for flows enabled on their account, and only for services that are enabled (system AND client level).
5. **Milling centres never see any price**, in any flow — this is already true today (`price_update_plan.md` step 8 stripped milling centres of any catalog/rate UI entirely) and nothing here changes that.

---

## 1. Current State (what exists today)

- `service_catalog` (`src/db/schema/price-list.ts`): one row per `(category, subCategory, serviceType)`, `serviceType ∈ {design_only, design_milling}`. Has `isActive` (system-level enable/disable) and `defaultPrice`. **No `milling_only` rows exist.**
- `client_price_list`: one row per `(clientId, catalogItemId)`. Has `price` + `notes`. **No enable/disable column** — a client either has a price override or falls back to the default; there's no way to hide a service from one client today.
- `cases.serviceType` (`src/db/schema/case.ts`): `pgEnum` with only `design_only` | `design_milling`. Drives which price-list row `getUnitPrice()` reads.
- `profiles`: no concept of "which flows can this client use." Every client can pick either of the two existing service types when submitting a case (`AddCaseDialog.tsx`).
- `getUnitPrice()` / `buildInvoiceItems()` (`src/lib/invoice.ts`): keyed on `category:subCategory:serviceType`, union type hardcoded to the 2 existing values.
- Milling centres: per `price_update_plan.md`, already have **zero** pricing/catalog UI in their portal — admin-managed only. Nothing to change here.
- No status/transition state machine exists in code — status changes are just role-gated UI actions (`CASE_STATUS_TO_LIFECYCLE_STEP`, `CLIENT_STATUS_LABELS`, `INTERNAL_STATUS_LABELS` are display maps, not validators).

---

## 2. Schema Changes

### 2A. `src/db/schema/case.ts`

- Extend `serviceTypeEnum`:
  ```ts
  export const serviceTypeEnum = pgEnum("service_type", [
  	"design_only",
  	"design_milling",
  	"milling_only",
  ]);
  ```
- **No new `caseStatusEnum` values needed.** A Milling Only case reuses the existing statuses, just skips the design-specific ones:
  - Used: `scan_received`, `scan_verified`, `scan_not_verified`, `on_hold`, `ready_for_milling`, `milling_in_progress`, `milling_qc`, `packaging`, `dispatched`, `delivered`, `cancelled`, `client_reject`.
  - **Not used for Milling Only**: `allocated_to_designer`, `in_progress`, `internal_qc`, `submitted_to_client`, `client_feedback`, `approved`, `change_requested` — these are all design-stage statuses. A Milling Only case goes `scan_verified` → (admin reviews the uploaded file, no designer/QC assignment) → `ready_for_milling` directly.
- Update `CASE_LIFECYCLE_STEPS` / `CASE_STATUS_TO_LIFECYCLE_STEP`: keep the status→step lookup as-is (still valid — `scan_verified` still maps to `'In Validation'` for everyone), but wherever the UI renders a _progress bar_ of all lifecycle steps (client case detail), filter out `'In Design'`, `'Internal QC'`, `'Pending Client Approval'` when `case.serviceType === 'milling_only'`.
- `EDITABLE_STATUSES` unchanged — still the pre-work statuses.

### 2B. `src/db/schema/price-list.ts`

- `serviceCatalog.serviceType` now allows the third enum value automatically once 2A lands (it reuses `serviceTypeEnum` from `case.ts`). No column change needed, just new rows.
- Unique constraint `(category, subCategory, serviceType)` already supports a third row per category/subCategory — no change.
- **Add `isEnabled` to `clientPriceList`**:
  ```ts
  isEnabled: boolean('is_enabled').default(true).notNull(),
  ```
  This is the client-level override of the system `serviceCatalog.isActive` flag. Semantics: a service is available to a client only if **both** `serviceCatalog.isActive === true` AND `clientPriceList.isEnabled === true`. Disabling at the system level always wins (hides it for everyone regardless of client override).

### 2C. `src/db/schema/profile.ts`

- **Add `enabledServiceTypes` to `profiles`**:
  ```ts
  enabledServiceTypes: text('enabled_service_types').array().notNull().default(sql`'{design_only}'::text[]`),
  ```
  Only meaningful for `role = 'client'` (subusers inherit their parent client's value at read time — same pattern already used for price lists via `resolveClientIdFromProfile`). Default `['design_only']` so existing clients keep exactly their current behavior after migration (they already only ever use Design Only / Design+Milling — see backfill note below).

### 2D. Migration `src/db/migrations/0047_service_catalog_flows.sql`

Covers:

1. Add `'milling_only'` to the `service_type` Postgres enum.
2. Add `is_enabled boolean not null default true` to `client_price_list`.
3. Add `enabled_service_types text[] not null default '{design_only}'` to `profiles`.
4. **Backfill**: for every existing client, set `enabled_service_types = '{design_only, design_milling}'` (both existing flows stay available — nobody loses access to something they already use today). Only _new_ clients created after this ships default to `{design_only}` only, per admin's decision at onboarding.
5. **Seed `milling_only` catalog rows**: for every existing `(category, subCategory)` in `service_catalog`, insert a matching `milling_only` row (`isActive = false` by default — admin must explicitly turn each one on and set a price, since Milling Only pricing is a new commercial decision, not a copy of Design pricing).
6. `src/db/schema/index.ts` — no change needed, `milling.ts`/`price-list.ts`/`case.ts` already exported.

> Do **not** auto-seed `milling_only` rows into `client_price_list` at `isEnabled = true` — `seedClientPriceList` already runs `onConflictDoNothing`, so it will insert `milling_only` rows for every client (needed so `getPriceListForClient` doesn't 404 client price rows), but they inherit `isEnabled = true` by default per-row while the _flow itself_ stays gated by `profiles.enabledServiceTypes`. Two independent gates, both must pass.

---

## 3. Server Library Changes

### 3A. `src/lib/price-list.ts`

- Broaden every `'design_only' | 'design_milling'` union to `'design_only' | 'design_milling' | 'milling_only'` (`getPriceListForClient`, `getServiceCatalog`).
- `getServiceCatalog`: also select `isActive` (currently dropped from the returned shape) so the admin UI can render the toggle state, not just active rows. Change the `where` to no longer hard-filter `isActive = true` when called from an admin context (admin needs to see disabled rows too, to be able to re-enable them) — add an `includeInactive` param, default `false` (client-facing calls keep today's behavior of only returning active rows).
- `getPriceListForClient`: also select `clientPriceList.isEnabled`; same `includeInactive` param for the admin call path.
- `updateCatalogDefaultPrices` → keep as-is, **add** `updateCatalogActiveStatus(items: Array<{ id: string; isActive: boolean }>)`.
- `updateClientPriceList`: extend the upserted row to also set `isEnabled` (add `isEnabled?: boolean` to the input item type, default `true` on insert, preserved on update if omitted).
- **New**: `getClientEnabledServiceTypes(clientId)` / `setClientEnabledServiceTypes(clientId, types)` — thin wrappers around `profiles.enabledServiceTypes`, used by the client-facing case-submission and price-list endpoints.
- `seedClientPriceList`: unchanged structurally — already seeds every active catalog row (all 3 service types) per client; `onConflictDoNothing` means it never clobbers per-client `isEnabled`/`price` overrides.

### 3B. `src/lib/price-list-shared.ts`

- `PriceListEntryFull` gains `isActive: boolean` (system) and `isEnabled: boolean` (client-level, only meaningful on rows coming from `getPriceListForClient`; default `true` on catalog-only rows).
- `mergeByServiceType` → extend to `mergeByServiceType(designOnly, designMilling, millingOnly)` returning a `MergedPriceRow` with three optional sides: `designOnly`, `designMilling`, `millingOnly`. Each `MergedPriceRowSide` gains `isActive` / `isEnabled`.

### 3C. `src/lib/invoice.ts`

- Broaden the `serviceType` union everywhere to include `'milling_only'`.
- `getUnitPrice(clientId, category, subCategory, serviceType)`: no logic change needed — it already does a flat lookup keyed by all three columns; it will just work once the union type is widened. Note it does **not** check `isActive`/`isEnabled` — a disabled service still prices correctly for _existing_ cases/invoices (disabling only blocks _new_ case submission, per §5A). This is intentional: don't let an admin toggling a service off retroactively zero out historical invoice math.
- `buildInvoiceItems`: `Group.serviceType` union widened; `modelCountByServiceType` (`Map<'design_only' | 'design_milling', number>`) widened to include `'milling_only'`. The grouping/description logic (`... (Design + Milling)` suffix) gets a matching `(Milling Only)` suffix branch. No structural change otherwise — Milling Only cases carry the same `category`/`subTypeData` shape as any other case (the client picks the same restoration type when submitting), so `mapCaseToPricingInput` needs no change.

---

## 4. Admin API Routes

| Route                                                   | Change                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/service-catalog?serviceType=`           | Accept `milling_only`. Add `?includeInactive=true` (admin UI always passes this — needs to see + toggle disabled rows).                                                                                                        |
| `PUT /api/admin/service-catalog`                        | Extend accepted body items to optionally include `isActive` alongside `defaultPrice`, so one save can update both price and enable state per row. Internally calls `updateCatalogDefaultPrices` + `updateCatalogActiveStatus`. |
| `GET /api/admin/clients/[id]/price-list?serviceType=`   | Accept `milling_only`. Add `?includeInactive=true`.                                                                                                                                                                            |
| `PUT /api/admin/clients/[id]/price-list`                | Extend accepted item shape to include `isEnabled?: boolean`. Invalidate all three Redis keys (`price-list:client:${id}:design_only                                                                                             | design_milling   | milling_only`), not just two.                                                                                                                                             |
| **New** `GET/PUT /api/admin/clients/[id]/service-types` | Read/write `profiles.enabledServiceTypes` for one client. `PUT` body: `{ enabledServiceTypes: ('design_only'                                                                                                                   | 'design_milling' | 'milling_only')[] }`. Validates at least one flow stays enabled (a client with zero flows can't submit any case). Logs `activity-log`entry`client.service_types_updated`. |

---

## 5. Admin UI

### 5A. Admin Profile page (`/admin/profile`) — Default Price List

Becomes **3 tabs**: **Design Only / Design+Milling / Milling Only** (reuses the existing `PriceListTable` merge pattern from `price_update_plan.md`, extended from 2-column to a 3-tab layout since cramming 3 service types side-by-side as columns is too wide).

Each tab, per row: `Service | Unit | Enabled (toggle) | Default Price (editable, disabled input when Enabled=off)`.

- Toggling **Enabled off** for a system-default service:
  - Removes it from that flow's case-submission dropdown for _every_ client (see §6A).
  - Removes it from that flow's price-list view for _every_ client, regardless of their own per-client `isEnabled`.
  - Does **not** touch existing cases/invoices already using it.
- "Refresh from DB" button per tab (existing `?refresh=true` pattern).

### 5B. Admin Client Detail page (`/admin/clients/[id]`) — Allocated Price List

Two additions on top of the existing single-table-per-client pattern:

1. **"Enabled Flows" control** at the top of the pricing section — 3 checkboxes/switches: Design Only, Design+Milling, Milling Only. Calls the new `/api/admin/clients/[id]/service-types` route. Changing this immediately affects what the client can submit and see (§6).
2. **3 tabs** (same Design Only / Design+Milling / Milling Only split as §5A), each row: `Service | Unit | Default Price (ref, from system catalog) | System Enabled (ref, greyed if system-disabled) | Client Enabled (toggle) | Client Price (editable)`.
   - If a flow isn't enabled for this client (per the checkbox in step 1), its tab is still visible to admin (so they can pre-configure pricing before turning the flow on) but shows a banner: "This flow is not enabled for this client — they won't see it until you enable it above."
   - A row where the _system_ toggle is off is fully locked (no client-level override possible) — greyed out with "Disabled system-wide."

### 5C. `MillingSubNav.tsx` / `/admin/milling/*`

No change — `price_update_plan.md` already removed the milling-centre-facing pricing tab from here; this plan doesn't reintroduce it. Milling Only pricing lives entirely in §5A/§5B, same as Design and Design+Milling.

---

## 6. Client View

### 6A. Case submission — `src/components/AddCaseDialog.tsx`

- On dialog open, fetch the current client's `enabledServiceTypes` (new lightweight `GET /api/client/service-types` route, or piggyback on an existing profile-fetch call already made by the dialog).
- The Service Type `RadioGroup` (currently hardcoded to 2 options, lines ~605–636) renders **only the enabled flows** as options:
  - If exactly one flow is enabled, skip the radio group entirely and just set `serviceType` to that value (no decision needed from the client).
  - If `milling_only` is enabled, add a third card: "Milling Only — Upload your finished design file, we mill and ship the physical product" with copy that makes clear no design service is included, and the upload requirement (a mill-ready file) is called out.
- When `milling_only` is selected, category/restoration selection stays the same (still need to know _what_ is being milled for routing/pricing), but the file upload area's helper copy changes to require a manufacturing-ready file rather than a raw scan (still same underlying `case_files` mechanism, just a copy/label change — no schema impact).

### 6B. Client price list — Profile page / `ClientPriceListModal.tsx`

- Tabs limited to the client's enabled flows only (a client with only Design Only enabled sees a single un-tabbed table, matching today's UX for that case).
- Within an enabled flow's tab, only rows where `isActive (system) && isEnabled (client)` are shown — a client never sees a disabled service or a `0.00`/placeholder price for something they can't order. This directly satisfies "client only see price based on which flow is enabled on their account."
- Columns: just `Service | Unit | Price` (read-only) — no Default/system columns, unchanged from the existing assumption in `price_update_plan.md`.

### 6C. Client case detail — `src/app/client/cases/[id]/page.tsx`

- For `serviceType === 'milling_only'` cases: lifecycle progress bar omits `'In Design'`, `'Internal QC'`, `'Pending Client Approval'` steps (per §2A). Timeline copy: "File received" → "Verified" → "In Production" → "Packaging" → "Shipped" → "Delivered" — no design-stage language, no milling-centre identity (same redaction rules as Design+Milling already documented in `milling-implementation-plan.md` §8D).

---

## 7. Milling Centre View

**No functional change.** Per `price_update_plan.md`, milling centres already:

- Have no service-catalog or rate-entry UI (`/milling/services` was deleted in that plan).
- Never receive pricing in any API response (`/api/milling/*` routes strip it by construction).

For Milling Only cases specifically, the only difference from Design+Milling cases at the milling-centre layer is _when_ the assignment happens (immediately after `scan_verified` instead of after design `approved`) — `millingCaseAssignments` and `/api/milling/cases/*` need no schema or contract change, they already key off `caseId` and don't care which flow produced the assignment. `millingRoutingRules.scope` (`products`/`restorations`) already matches on category/subCategory, which Milling Only cases have same as any other.

### 7A. Admin Case Detail — `src/app/admin/cases/[id]/page.tsx`

- For `serviceType === 'milling_only'`: skip the Designer/QC assignment fields entirely (there is no design phase). After `scan_verified`, show the **"Assign to Milling Center"** action directly (same routing-engine flow as Design+Milling's Milling tab, just reachable one step earlier in the case lifecycle).

---

## 8. Billing & Invoice Generation

Flow is symmetric with the existing Design vs Design+Milling split documented in `milling-implementation-plan.md` §Phase 9, extended to 3 branches:

1. Admin sets the **Milling Only** default price per service (§5A) and optionally a per-client override (§5B) — same mechanism as the other two flows, no partner-rate/markup math (consistent with the "no computed markup" decision already made in `price_update_plan.md`).
2. When generating an invoice, `buildInvoiceItems()` groups selected cases by `category:subCategory:serviceType` (now 3-way) and calls `getUnitPrice(clientId, category, subCategory, case.serviceType)` per group — no new code path, just the widened union type from §3C.
3. Invoice line-item description gets a `(Milling Only)` suffix, mirroring the existing `(Design + Milling)` suffix, so admin and client can tell which flow a line item belongs to on the PDF/CSV export.
4. `src/app/api/billing/clients/[clientId]/route.ts` and `src/app/api/admin/invoices/[id]/case-sheet/route.ts` (`buildPriceMap`) — both already keyed by `category:subCategory:serviceType` per the fix in `price_update_plan.md` §Confirmed bugs; only the union-type widening is needed, no new bug class.
5. A case whose service was disabled _after_ the case was created still invoices correctly (§3C note) — disabling only gates future submissions, never past pricing.

---

## 9. Open Assumptions — flag if wrong

1. **Milling Only lifecycle assumes no client design-approval step.** Since Iconic does no design work, there's nothing for the client to approve before milling starts — admin verifies the uploaded file is millable and assigns a centre directly. If you actually want a client-facing confirmation step ("yes, mill exactly this file") before production starts, that's an extra status (e.g. `pending_milling_confirmation`) not currently planned.
2. **New clients default to only `design_only` enabled**; existing clients are backfilled to `{design_only, design_milling}` so nobody loses access on migration day. Milling Only is opt-in per client, admin-enabled, starting disabled for everyone until turned on.
3. **System-level `isActive = false` always overrides client-level `isEnabled = true`** — a client can never see/order a service the admin has globally disabled, even if their own per-client flag is still "on" from before.
4. **Milling Only catalog rows seed at `isActive = false`** (§2D) — admin must deliberately turn on and price each service for this new flow rather than inheriting Design pricing, since Milling Only is a new commercial offering with no natural default price.
5. **Disabling a service does not retroactively affect existing cases/invoices** — only blocks new case submission and hides it from price-list views going forward.

---

## 10. File List

### New files

- `src/db/migrations/0047_service_catalog_flows.sql`
- `src/app/api/admin/clients/[id]/service-types/route.ts`
- `src/app/api/client/service-types/route.ts`

### Modified files

| File                                                  | Change                                                                                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/schema/case.ts`                               | `serviceTypeEnum` gains `'milling_only'`; lifecycle-step rendering becomes serviceType-aware                                                                                        |
| `src/db/schema/price-list.ts`                         | `clientPriceList` gains `isEnabled` column                                                                                                                                          |
| `src/db/schema/profile.ts`                            | `profiles` gains `enabledServiceTypes` column                                                                                                                                       |
| `src/lib/price-list.ts`                               | widened unions, `includeInactive` param, `updateCatalogActiveStatus`, `isEnabled` support in `updateClientPriceList`, `getClientEnabledServiceTypes`/`setClientEnabledServiceTypes` |
| `src/lib/price-list-shared.ts`                        | `PriceListEntryFull`/`MergedPriceRow` gain `isActive`/`isEnabled`; `mergeByServiceType` takes 3 inputs                                                                              |
| `src/lib/invoice.ts`                                  | widened `serviceType` unions in `getUnitPrice`, `buildInvoiceItems`, `modelCountByServiceType`; `(Milling Only)` description suffix                                                 |
| `src/app/api/admin/service-catalog/route.ts`          | `includeInactive` query param, `isActive` in PUT body                                                                                                                               |
| `src/app/api/admin/clients/[id]/price-list/route.ts`  | `milling_only` serviceType support, `isEnabled` in PUT body, 3-key cache invalidation                                                                                               |
| `src/app/api/billing/clients/[clientId]/route.ts`     | widened serviceType union (no new bug — already keyed correctly per `price_update_plan.md`)                                                                                         |
| `src/app/api/admin/invoices/[id]/case-sheet/route.ts` | widened serviceType union, CSV suffix                                                                                                                                               |
| `PriceListTable.tsx`                                  | 3-tab layout instead of 2-column, Enabled toggle column                                                                                                                             |
| `ClientPriceListModal.tsx`                            | tabs filtered to client's enabled flows, enabled-only rows                                                                                                                          |
| `admin/(dashboard)/profile/page.tsx`                  | 3-tab Default Price List                                                                                                                                                            |
| `admin/(dashboard)/clients/[id]/page.tsx`             | Enabled Flows control + 3-tab Allocated Price List                                                                                                                                  |
| `src/components/AddCaseDialog.tsx`                    | Service Type options filtered to client's enabled flows, 3rd Milling Only option added                                                                                              |
| `src/app/admin/cases/[id]/page.tsx`                   | Milling Only cases skip Designer/QC assignment, show Milling tab earlier                                                                                                            |
| `src/app/client/cases/[id]/page.tsx`                  | Milling Only lifecycle bar omits design-stage steps                                                                                                                                 |

---

## 11. Build Order

| Order | Step                                                         | Why                                                                                            |
| ----- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1     | Schema + migration (§2)                                      | Everything depends on `milling_only` existing as a valid enum value and the new columns        |
| 2     | `price-list.ts` / `price-list-shared.ts` / `invoice.ts` (§3) | Server logic must support 3 flows before any API/UI touches it                                 |
| 3     | Admin APIs (§4)                                              | Admin needs to configure services/pricing/flows before clients or milling centres can use them |
| 4     | Admin UI (§5)                                                | Admin turns on Milling Only, sets prices, enables it for pilot clients                         |
| 5     | Client UI (§6)                                               | Clients can now see/submit Milling Only once admin has enabled it for them                     |
| 6     | Admin case detail + milling assignment (§7A)                 | Case flow wiring for the new shorter lifecycle                                                 |
| 7     | Billing (§8)                                                 | Verify invoice generation against real Milling Only cases end-to-end                           |
