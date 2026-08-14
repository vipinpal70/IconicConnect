# Enforce per-service enable/disable at case creation

## 0. The bug (recap, already confirmed by code read)

Admin can disable a client's access to a service two ways:

1. **Flow toggle** (Design / Design+Milling / Milling Only) → `profiles.enabledServiceTypes`. **Enforced correctly** server-side in `POST /api/cases` (`src/app/api/cases/route.ts:183, 195-201`).
2. **Individual service** toggle (e.g. "Crown" under Crown & Bridge) → `service_catalog.isActive` (system-wide) + `client_price_list.isEnabled` (per-client). **Never checked anywhere.** `cases.category`/`cases.subTypeData` are inserted straight from the request body (`route.ts:216-228`) with no lookup against the catalog at all. The UI dropdowns aren't filtered either — both case-creation forms use a hardcoded, static list of categories/sub-types, never fetched from the price list.

That part was already confirmed. The rest of this plan is what digging into *how* to fix it turned up.

## 1. The real blocker: category/sub-category naming has drifted across 4 independent places

To reject "Crown / Bridge / etc. is disabled for this client," the server needs to match a submitted `(category, subTypeData)` back to a `service_catalog` row. That match only works if the strings agree. **They currently don't**, across four places that all define the same conceptual list independently:

| Source | Crown & Bridge | Denture(s) | Cosmetic(s) | Appliance(s) | Implant(s) |
|---|---|---|---|---|---|
| `service_catalog` (DB, source of truth for pricing) | `Crown & Bridge` | `Dentures` | `Cosmetics` | `Appliances` | `Implants` |
| `AddCaseDialog.tsx` (`CASE_HIERARCHY`, admin+client "Add Case" dialog) | `Crown & Bridge` ✅ | `Denture` ❌ | `Cosmetic` ❌ | `Appliance` ❌ | `Implant` ❌ |
| `client/(dashboard)/cases/page.tsx` (`CASE_HIERARCHY`, client cases page form) | `Crown & Bridges` ❌ | `Denture` ❌ | `Cosmetics` ✅ | `Appliances` ✅ | `Implant` ❌ |
| `case-utils.ts` (`CATEGORY_PREFIXES`, case-number prefix) | `Crown & Bridges` ❌ | `Denture` ❌ | `Cosmetics` ✅ | `Appliances` ✅ | `Implant` ❌ |

(`3D Model` is the one category that's already spelled identically everywhere.)

This isn't hypothetical drift — it has an existing, separate symptom: because `getCasePrefix()` (`src/lib/case-utils.ts:10-19`) falls back to auto-deriving a prefix from the raw string when it's not an exact key in `CATEGORY_PREFIXES`, a case created via `AddCaseDialog.tsx` with `category: "Cosmetic"` gets a *different* auto-derived case-number prefix than one created via the client cases page with `category: "Cosmetics"`, even though they're the same category. That's a pre-existing bug independent of this report, caused by the same root drift.

On top of the category-name drift, two **sub-category values** also don't match the catalog:

- Catalog has `Spot Guards`; both UI forms say `Sport Guard` / `Sports Guard` — three different spellings of what's presumably the same "sport mouthguard" service. I'm assuming `service_catalog`'s `Spot Guards` is the typo (should be `Sport Guards`) — **please confirm**, since fixing this means editing a live pricing catalog row.
- Catalog has `Veneers`; `client/cases/page.tsx` has `Vineers` (typo). `AddCaseDialog.tsx` already says `Veneers` correctly.

**Consequence for the fix:** if I add the enforcement check today using naive string matching, it will falsely reject Denture/Cosmetic/Appliance/Implant cases for *every* client (because the category names don't match anything in the catalog), which is worse than the current bug — that would break case creation entirely for those categories, not just for clients with a service explicitly disabled.

## 2. Fix plan (staged — each stage is independently safe to ship)

### Stage 1 — Consolidate to one canonical hierarchy

Extract a single shared source of truth, e.g. `src/lib/case-hierarchy.ts`, exporting the category → fields/options structure. Both `AddCaseDialog.tsx` and `client/(dashboard)/cases/page.tsx` import from it instead of keeping their own copies. Category and sub-category **keys** are changed to match `service_catalog` exactly (`Crown & Bridge`, `Dentures`, `Cosmetics`, `Appliances`, `Implants`, `3D Model`), since that's the table holding real, live per-client pricing — far more disruptive to rename than a UI label.

Also update `case-utils.ts`'s `CATEGORY_PREFIXES` map to the same canonical keys, fixing the case-number-prefix inconsistency as a side effect.

### Stage 2 — Server-side enforcement in `POST /api/cases`

After the existing flow check (`route.ts:195-201`), for each submitted case: call `getPriceListForClient(clientId, serviceType)` (already exists, `src/lib/price-list.ts:31-73`, already does the `isActive && isEnabled` merge) and look up the row(s) matching the submitted category/sub-category (see §3 for what "matching row(s)" means per category — it's not always exactly one). Reject with a 400 naming the specific disabled service if any matched row has `isActive === false` or `isEnabled === false`.

This is the actual fix for the reported bug — everything else in this plan exists to make this step safe to add.

### Stage 3 — UI filtering

Both forms already fetch `enabledServiceTypes` and filter the flow radio buttons. Extend that: fetch the client's price list too (`/api/client/price-list` for the client-role form, `/api/admin/clients/[id]/price-list` for the admin-role `AddCaseDialog`, both already exist and already return `isActive`/`isEnabled` per row) and filter out disabled categories/sub-type options from the dropdowns, same pattern already used at `client/(dashboard)/profile/page.tsx:74` (`rows.filter(r => r.isEnabled)`). This means a client never even sees a disabled option, rather than picking it and getting a 400 from Stage 2.

### Stage 4 — Data typo fixes (needs your confirmation, see §1)

Update the `Spot Guards` → `Sport Guards` and `Vineers` → `Veneers` values. Low risk (renaming a string on an existing catalog row doesn't touch any foreign key — `client_price_list` references `catalogItemId`, not the string), but I want to confirm the "Spot Guards" direction before touching a live pricing row.

## 3. Compound selections — not every case maps to exactly one catalog row

Two categories select more than one billable service per case, and Stage 2's lookup needs to check all of them, not just the primary one:

- **3D Model**: `caseType1` (Full Arch Model / Quad Model / Contact Model / Horse Shoe Model / Implant Model) is the primary service. `die`, `articulator`, `drainHoles` are independent Yes/No add-on flags, each corresponding to its *own* `service_catalog` sub-category row (`Die`, `Articulator`, `Drain Holes`). `caseType2` (Hollow/Solid) is just metadata, not a priced service. So a single 3D Model case can imply up to 4 catalog rows to check (1 primary + up to 3 add-ons), each independently possibly disabled.
- **Implant**: `caseType1` (Robotic/Custom/Ti-Base) is the primary Implants-category service. `caseType2` (None/Crown/Bridge), when not "None," implies an *additional* Crown & Bridge-category service (`Crown` or `Bridge`) attached to the implant case — a second catalog lookup under a different category.

Everything else (Crown & Bridge, Dentures, Cosmetics, Appliances) is a simple single category+sub-category lookup.

## 4. Decisions needed before I implement

1. **Confirm the typo direction**: is `Sport Guards` correct (and `service_catalog`'s `Spot Guards` the typo), or is it intentional? Same question for `Veneers` vs `Vineers` (I'm confident `Veneers` is correct, flagging for completeness).
2. **Rejection message granularity**: when a case is rejected for a disabled service, is a generic "This service is not available for your account" enough, or should it name the specific service (e.g. "Crown & Bridge / Crown is not enabled for your account")?
3. Confirmed no objection to renaming the category keys in code (`Denture`→`Dentures`, `Cosmetic`→`Cosmetics`, `Appliance`→`Appliances`, `Implant`→`Implants`) to match the DB — this doesn't touch any existing `cases` rows (their `category` string stays whatever was stored at creation time; only *new* submissions use the new canonical spelling).

## 5. Files touched

**New:**
- `src/lib/case-hierarchy.ts` — consolidated category/sub-type definitions (Stage 1)

**Modified:**
- `src/components/AddCaseDialog.tsx` — import shared hierarchy, add price-list fetch + option filtering (Stages 1, 3)
- `src/app/client/(dashboard)/cases/page.tsx` — same (Stages 1, 3)
- `src/lib/case-utils.ts` — `CATEGORY_PREFIXES` keys aligned to canonical names (Stage 1)
- `src/app/api/cases/route.ts` — per-service enforcement check added after the existing flow check (Stage 2)
- `src/db/migrations/00XX_fix_catalog_typos.sql` (only if you confirm §4.1) — `Spot Guards`→`Sport Guards`, `Vineers`→`Veneers` (Stage 4)

## 6. Out of scope

- No FK from `cases` to `service_catalog` is being added — matching stays by `(category, subCategory)` string equality against the now-canonical hierarchy, not a relational link. A real FK would be a larger, separate migration.
- Not touching historical `cases` rows already stored with the old inconsistent category strings — this only affects new submissions going forward.