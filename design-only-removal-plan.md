# Design-Only Conversion Plan — remove Design + Milling, Milling Only and the Milling Centre portal

Branch: `phase2-designOnly` (from `phase2`). **Status: Phases 1–6 implemented (uncommitted). Phase 2 script written but `--apply` not yet run. Phase 7 (destructive DB migration) pending.**

Business decision: Iconic and its clients deliver **design only**. There is no milling, no
milling centre, no partner designer, no physical shipping. This repo must not contain any of it.

Everything below was verified against the code on `phase2` (HEAD `404632c`). Line numbers drift — re-grep
before editing. Sources read: all root `.md` plans (`milling-*`, `case-flow-update-plan`, `plan`,
`implement-plan`, `service-catlog-manage-plan`, `price_update_plan`, `case-architecture-plan`, …) plus the code.

---

## 1. Target end state

| Area | After |
|---|---|
| Case flows | One flow: the current `design_only` (Submitted → Validation → Design → Internal QC → Client Review → Approved/Completed). |
| Client sign-up | No "which service do you need" step. |
| Case creation | No flow picker; no "milling-ready design upload" variant; one price list. |
| Price list / catalog | One catalog (no `serviceType` dimension in UI); one tab in admin profile and client-detail pages. |
| Billing / invoices | Lines priced from the single catalog; no "(Design + Milling)" suffixes. |
| Portals | `admin`, `ops` (qc/designer/account_manager), `client`. **No `/milling` portal, no `milling_*` roles.** |
| Design delivery | Only internal designers (`cases.designerId`). The "Design Partner" (milling centre as designer) feature is removed too. |
| Statuses | Remove `ready_for_milling`, `milling_in_progress`, `milling_qc`, `packaging`, `dispatched`. |

`delivered` is not a milling-only status — it is in the `design_only` mapping, so it stays.

---

## 2. Open decisions (need an answer before Phase 5 / DB work)

1. **Existing production data.** Are there real cases with `service_type` ≠ `design_only`, rows in
   `milling_centers`, or `profiles.user_type = 'milling_portal'`? (Run the audit queries in §9 first.)
   Recommended handling: convert every case to `design_only`; archive (export to CSV) then delete milling
   centres/users; leave historical invoices untouched (their JSON snapshots keep `serviceType`).
2. **Clients who were `design_milling` / `milling_only` priced.** Recommended: their `client_price_list`
   rows for those flows are deleted; their `design_only` prices stay as-is. Confirm that existing
   `design_milling` invoices already issued are not re-generated.
3. **Drop DB columns/enums now, or later?** Recommended: **two-step.** Step 1 (this plan, Phases 1–6) removes all
   code and behaviour and *keeps* the `service_type` columns, always `design_only`. Step 2 (Phase 7) is a
   destructive migration that drops tables/columns and recreates the Postgres enums. Doing both at once makes
   rollback impossible.
4. **Keep `cases.designSource`?** It only exists for the partner-designer flow → drop.

---

## 3. What exists today (inventory)

### 3.1 Whole-feature areas to delete outright

| Area | Paths |
|---|---|
| Milling portal UI | `src/app/milling/**` (layout, dashboard, cases, cases/[id], services, support) |
| Milling portal API | `src/app/api/milling/**` (cases, dashboard, me, services, support, design-files, files, shipment, status) |
| Admin milling UI | `src/app/admin/(dashboard)/milling/**` (overview, centers, centers/[id], routing, analytics, `_components`) |
| Admin milling API | `src/app/api/admin/milling/**` (centers, contract, service-catalog, routing, users, credentials, cases, analytics) |
| Case-level milling API | `src/app/api/cases/[id]/milling-assign/route.ts`, `src/app/api/cases/[id]/design-assign/route.ts` |
| Components | `AssignMillingCenterDialog.tsx`, `AssignDesignPartnerDialog.tsx`, `MillingLayout.tsx`, `MillingServiceCatalogTable.tsx`, `MillingSidebar.tsx`, `MillingStatusBadge.tsx` |
| Lib | `src/lib/milling/*` (admin-guard, assignment, case-view, create-milling-user, due-date, eligibility, portal-guard, routing-engine) — **but see trap #1 below** |
| Schema | `src/db/schema/milling.ts` (tables: `milling_centers`, `milling_service_catalog`, `milling_routing_rules`, `milling_case_assignments`, `case_center_assignment_history`; enums: `milling_status`, `assignment_scope`, `assignment_role`, `assignment_action`) |
| Scripts | `scripts/seed-milling-only-catalog.mjs`, `scripts/backfill-milling-only-data.ts`, `package.json` script `db:seed-milling-only-catalog` |
| Upload helper | `uploadMillingCenterContract` in `src/lib/upload-utils.ts:327-` |

### 3.2 Traps — things in the milling folders that non-milling code depends on

1. **`src/lib/milling/admin-guard.ts` is imported by 14 non-milling routes** (`requireAdmin`, `requireStaffRole`),
   e.g. `src/app/api/admin/cases/[id]/bulk-download/reset/route.ts`. **Move it to `src/lib/auth/admin-guard.ts`
   first** and re-point every import, *then* delete `src/lib/milling/`. Run
   `grep -rl "milling/admin-guard" src` to get the list.
2. `src/lib/bulk-download/access.ts` / `collect.ts` allow-lists contain `milling_*` roles.
3. `src/lib/queue/r2-cleanup-task.ts` protects `milling_centers.contract_doc_key` from cleanup — remove that
   query (it imports the milling schema; deleting the schema breaks it).
4. `src/lib/case-access.ts` `denyUnlessMillingAssigned` is called by `api/cases/[id]/route.ts` and
   `api/cases/[id]/activity/route.ts`; `src/lib/__tests__/case-access.test.ts` mocks the milling schema.
5. `src/lib/admin/delete-client.ts` comment/behaviour mentions `milling_case_assignments` cascade.
6. `src/components/CaseDetailView.tsx` imports a type from `lib/milling/routing-engine`.

### 3.3 Non-milling files that need edits (grouped)

**Auth / routing**
- `src/proxy.ts` — `milling_*` role redirect (~213-216), `isAllowedMillingPath` (~232-243), `/api/admin/milling` guard (~305).
- `src/app/api/sign-in/route.ts` (~71-74) — milling redirect branch.
- `src/lib/auth/role.ts:4` — `milling_portal` role map.
- `src/lib/case-status-transitions.ts` — `MILLING_ROLES`, partner-designer rules, milling-production guard.
- `src/lib/case-utils.ts` comments; `case-access.ts` (see trap 4).

**Sign-up / client onboarding**
- `src/app/auth/sign-up/page.tsx` — remove `SERVICE_TYPE_OPTIONS` block + validation (~18-21, 58, 93, 131, 308-320).
- `src/app/api/sign-up/route.ts` — remove `VALID_SERVICE_TYPES`, "select at least one service" 400 (~13, 87-92, 110, 145).
- `src/app/api/admin/clients/[id]/service-types/route.ts` and `src/app/api/client/service-types/route.ts` — delete.
- `src/app/admin/(dashboard)/clients/[id]/page.tsx` — remove flow toggles + the three price-list tabs (~44-49, 73-107, 181-215, 297, 419, 491); keep a single price list.
- `src/app/client/(dashboard)/profile/page.tsx` (~65-104) — drop `/api/client/service-types` fetch; single price list.
- `profiles.enabled_service_types` — drop in Phase 7.

**Case creation**
- `src/app/client/(dashboard)/cases/page.tsx` — flow card picker (~35-37, 394-395, 499-563, 1190, 1260-1268), per-flow price-list cache `priceListsByFlow`, bulk-row `serviceType`, "milling_only" upload copy (2GB/5GB variants).
- `src/components/AddCaseDialog.tsx` (admin) — same set (~22-24, 49-50, 198-283, 600, 781, 810-818).
- `src/components/ThreeShapeImport/ThreeShapeImport.tsx` — per-draft flow picker (~28-30, 73, 96-115, 193-231, 272, 548-557).
- `src/app/(ops)/cases/page.tsx` — local copy of the form logic + "Select Milling Centre" button (~71, 473, 625-635, 1192-1197, 1919-1927, 1976, 2329-2334).
- `src/app/api/cases/route.ts` — drop `enabledServiceTypes` enforcement + per-flow price-list map (~265-290, 360-363), `serviceType` column in POST insert (~392) and GET filter (~540-556, 577, 636).
- `src/app/api/cases/bulk/confirm/route.ts:235`, `src/lib/three-shape/map-to-case.ts:15` comment.
- `src/lib/case-hierarchy.ts` / `case-architecture-plan.md` — no milling content, only doc update.

**Case lifecycle**
- `src/db/schema/case.ts` — `caseStatusEnum` milling values (lines 18-24), `serviceTypeEnum`, `designSourceEnum`, `CASE_LIFECYCLE_STEPS` `'In Production'`, `CASE_STATUS_TO_LIFECYCLE_STEP`, `CLIENT_STATUS_LABELS` / `INTERNAL_STATUS_LABELS` entries, `cases.serviceType` (~170), `cases.designSource`.
- `src/lib/case-status-mapping.ts` — delete `designMilling` and `millingOnly` mappings; reduce `STATUS_MAPPING`/`ServiceType`; drop `milling_action` action type and `skippedStatuses`. **Simplest**: keep the file as the single-flow source of truth and make helper signatures drop the `serviceType` arg (callers: `StatusBadge`, `CaseDetailView`, `notification-dispatcher`, transitions, `api/cases/[id]/route.ts`).
- `src/app/api/cases/[id]/route.ts` — milling-portal PATCH branch (~478-495), partner designCenter lookup (~767-770), flow-aware guard (~201-216), `serviceType` args (~205, 747).
- `src/app/api/cases/[id]/approval-checklist/route.ts` — `skipsClientReview` branch and `autoAdvanceIfCommitted` (~11, 98-151). After removal QC approval always → `submitted_to_client` as in design_only.
- `src/app/api/cases/[id]/activity/route.ts` (~6, 28-29); `src/lib/activity-log.ts` — `milling_center.*`, `milling_user.*`, `milling_routing_rule.*`, `case.milling_*` labels (~69-95, 140-163).
- `src/components/StatusBadge.tsx` (`serviceType` prop), `CaseDetailView.tsx` (Milling tab, `MillingTab`, `hasMillingTab`, `activeTab`, lifecycle by flow; ~55, 196, 278, 337-343, 444, 877-882, 948-979, 1047, 2111-2400).
- `src/app/admin/(dashboard)/cases/page.tsx` — service-type filter (~279-293, 309, 347-382, 632-650, 1143-1158), both assign dialogs, `/api/admin/milling/cases` query (~507-543), post-approve milling-centre prompt (~825-846), Factory badge (~1397-1400), `designSource`.
- `src/app/api/admin/analytics/delivery-status/route.ts` — flow-aware `bucketFor` (the `approved` → "In Production" branch and milling statuses).
- `src/lib/notifications/notification-dispatcher.ts` — `notifyMillingCentre*` function (~289-340), `getStatusLabel(serviceType…)` (~104-108).

**Pricing / billing**
- `src/db/schema/price-list.ts:28,37-40` — `service_catalog.service_type` + `(category, sub_category, service_type)` unique.
- `src/lib/price-list.ts` — `CatalogServiceType`, `parseCatalogServiceType`, `getServiceCatalog`, `getPriceListForClient`, `setClientEnabledServiceTypes`, `getClientEnabledServiceTypes`, seeding by enabled flows (~25-260). Make every function design-only.
- `src/lib/price-list-shared.ts` — `mergeByServiceType` / `designMilling` / `millingOnly` merge types (~26-91) → delete merge; return single rows.
- `src/lib/price-list-cache.ts` — per-flow cache keys + `invalidatePriceListCache` loop.
- `src/lib/invoice.ts` — grouping keys include `serviceType` everywhere (~70-373), suffixes `(Design + Milling)` / `(Milling Only)`. Collapse to key `category:subCategory` and a fixed design_only catalog lookup.
- `src/db/schema/invoice.ts:30` — line-item `serviceType?` JSON type (keep optional for old invoices).
- `src/app/api/billing/clients/[clientId]/route.ts` (~20-252), `src/app/api/admin/invoices/[id]/case-sheet/route.ts` (~24-242) — price maps keyed by `serviceType`.
- `src/app/api/admin/service-catalog/route.ts`, `src/app/api/client/price-list/route.ts`, `src/app/api/admin/clients/[id]/price-list/route.ts` (the `designMillingData` / `millingOnlyData` response keys), `src/app/api/service-pricing/**`.
- `src/components/ClientPriceListModal.tsx` (~17-19), `src/app/admin/(dashboard)/profile/page.tsx` (~32-114, 207, 240, 273: three flow tabs), `src/app/admin/(dashboard)/billing/page.tsx` (~55, 541-543: Factory icon).
- `scripts/seed-price-list.ts`, `scripts/seed-3d-model-catalog.mjs`, `scripts/seed-implant-bars-catalog.mjs` — they insert rows with an explicit `service_type`; keep, hard-code `design_only`.

**Navigation / misc**
- `src/components/AdminSidebar.tsx:50,99` — "Milling" item and its Team/Milling `isNotAdmin` filter.
- `src/app/api/admin/user/Untitled-1.md` — stray scratch file, delete.

---

## 4. Phased implementation

Each phase ends with `npm run lint`, `npx tsc --noEmit`, `npm test`, and must leave the app bootable.

### Phase 0 — Safety net (before any code)
1. DB backup / snapshot; run audit queries (§9) against prod and save the numbers in the PR description.
2. Decide §2 items 1–3.
3. Add a feature-flag-free approach: this branch is one-way, so no flags.

### Phase 1 — Stop creating anything new (behaviour first, no deletions)
1. `POST /api/cases`: force `serviceType = 'design_only'`, ignore input. Remove `enabledServiceTypes` check.
2. Sign-up page/route: remove the service step; default `enabledServiceTypes = ['design_only']`.
3. Case-creation UIs (client page, `AddCaseDialog`, `ThreeShapeImport`, ops page): remove flow picker + milling-only upload copy, always send `design_only` (or omit).
4. Hide the "Milling" nav item and the Service Type filter on admin cases.
   *Result: nothing new can enter a milling flow; old data still renders.*

### Phase 2 — Data cleanup (one-off script, dry-run first)
New `scripts/convert-to-design-only.ts` (dry run by default, `--apply`), following the style of `scripts/backfill-milling-only-data.ts`:
1. For cases with `service_type ≠ 'design_only'`: set `service_type='design_only'`; map milling statuses → `approved` (or `delivered` when already delivered), `designSource` ignored. Write an `activity_logs` entry `case.converted_to_design_only` per case.
2. Delete `client_price_list` rows whose `service_catalog.service_type ≠ 'design_only'`, then delete those `service_catalog` rows.
3. `UPDATE profiles SET enabled_service_types = '{design_only}'` for all clients.
4. Export `milling_centers`, `milling_case_assignments`, `case_center_assignment_history` to CSV (kept outside the repo), then delete `milling_portal` profiles and Supabase auth users for them (reuse the deletion path in `delete-client.ts`), then delete milling rows.
5. Delete the R2 contract documents (`milling_centers.contract_doc_key`) **before** removing the R2 cleanup protection in Phase 3.

### Phase 3 — Remove the milling portal and APIs (pure deletions)
1. Move `admin-guard` (trap 1) and fix 14 imports.
2. Delete everything in §3.1 (portal UI/API, admin UI/API, case-level assign routes, components, lib, scripts).
3. Fix breakages named in §3.2 (bulk-download allow-lists, r2-cleanup, case-access, delete-client, CaseDetailView type import).
4. `proxy.ts`, `sign-in/route.ts`, `auth/role.ts`: remove milling roles/redirects.

### Phase 4 — Collapse the case-status / lifecycle code
1. `case-status-mapping.ts`: single flow; remove `ServiceType` param from helpers, update ~10 call sites.
2. `case-status-transitions.ts`: delete milling rules; keep flow guard as "is this status valid" only.
3. `approval-checklist/route.ts`: remove `skipsClientReview` branch. QC approve → `submitted_to_client` always.
4. `api/cases/[id]/route.ts`: delete milling-portal PATCH branch and partner lookups.
5. `CaseDetailView.tsx`: delete Milling tab and its 300-line `MillingTab`; single lifecycle array.
6. Admin & ops cases pages: remove dialogs, Factory badge, milling query, post-approve milling prompt.
7. `activity-log.ts`, `notification-dispatcher.ts`, `delivery-status` analytics: delete milling labels/branches (keep a tiny label map for **historical** `activity_logs` actions already stored — render them as "Legacy event" instead of crashing).
8. Remove milling statuses from `case.ts` constants/label maps (the Postgres enum itself waits for Phase 7).

### Phase 5 — Collapse pricing and billing
1. Make `price-list.ts` design-only (hard-code `'design_only'`), delete flow-aware helpers.
2. `invoice.ts`, `billing/clients/[clientId]/route.ts`, `case-sheet/route.ts`: key price maps by `category:subCategory`; remove suffixes.
3. Delete `service-types` routes; change `price-list` routes to return one list (no `designMillingData`/`millingOnlyData`); update `profile`/`clients/[id]` pages to a single table; delete `mergeByServiceType`.
4. Simplify `price-list-cache.ts` keys (bump key prefix so stale `iconic_price_list_design_only_*` browser caches don't collide).
5. **Regression check:** generate an invoice for a design_only-only client before/after; totals must match to the cent.

### Phase 6 — Docs and repo hygiene
1. Delete obsolete plans: `milling-implementation-plan.md`, `milling-center-admin-level-plan.md`, `milling-portal-plan.md`, `case-flow-update-plan.md`, `service-catlog-manage-plan.md`, `implement-plan.md` (Milling Only rollout), `plan.md` (3-flow status mapping). Keep them reachable in git history only.
2. Update still-relevant docs: `case-architecture-plan.md`, `case-creation-service-enforcement-plan.md`, `price_update_plan.md`, `3d-model-implement-plan.md`, `hold_images-plan.md`, `bulk-download-plan.md`, `xml-work-plan.md`, `security-review.md`, `bug-fix-implement-plan.md` — strip milling/flow references (grep `milling|design_milling|design partner`).
3. Update `flow.md` (remove nothing about roles; it has no milling now) — add the single-flow description.
4. Remove `db:seed-milling-only-catalog` from `package.json`.

### Phase 7 — Destructive DB migration (separate PR, after Phases 1–6 have run in prod for a release)
New migration `0058_remove_milling.sql` (+ journal entry; the runner in `scripts/migrate.mjs` batches migrations in one transaction, so **recreate-type** approaches must avoid `ALTER TYPE ADD VALUE` patterns — see the note in `0047`):
1. `DROP TABLE case_center_assignment_history, milling_case_assignments, milling_routing_rules, milling_service_catalog, milling_centers CASCADE`; drop `milling_status`, `assignment_scope`, `assignment_role`, `assignment_action` types.
2. `profiles`: drop `milling_center_id` (+ index), `enabled_service_types`.
3. `cases`: drop `design_source`; drop `service_type` (or keep column with a default — see §2.3); drop `design_source` type.
4. `service_catalog`: drop `service_type`, restore unique `(category, sub_category)` (dedupe first — the milling rows are already deleted in Phase 2).
5. Recreate `case_status` without the five milling values: create `case_status_new`, `ALTER TABLE cases ALTER COLUMN status TYPE case_status_new USING status::text::case_status_new`, same for any other table/column using the enum, drop old, rename. Needs a pre-check that **no row** still uses a removed value.
6. Drop `milling_portal` / `milling_*` from `user_type` / `user_role` enums the same way.
7. Remove milling RLS policies from `0040`/`0056` if any reference those tables (none found by grep, verify in migration).
8. Update `src/db/schema/*` and `meta/*snapshot` via `drizzle-kit generate`; do not hand-edit snapshots.

---

## 5. Edge cases and risks

- **In-flight cases** in a milling status at cutover → Phase 2 mapping; business must confirm they're really done or accept them as `approved`.
- **Historical invoices** store `serviceType` in JSON line items; keep the optional field so old invoices render.
- **Historical `activity_logs`** with `case.milling_*` actions: keep a fallback label; never throw on unknown action.
- **Notifications table** may hold links to `/milling/cases/:id` — delete those rows in Phase 2 or the link 404s.
- **`3D Model` / Model-only labs** (`profiles.model_only_lab`, `/api/client/model-only`) are **not** milling features — leave untouched.
- **Client-approval timing:** design_milling had no client approval; after removal every case uses client review. No behaviour change for design_only clients.
- **Browser caches:** price-list session/local storage keys — handled by prefix bump.
- **Admin sidebar badge counters** (`/api/sidebar-badges`) — verify no milling counter.
- Next.js in this repo is a modified version (see `AGENTS.md`): read `node_modules/next/dist/docs/` before touching route/layout deletions (e.g. `proxy.ts` conventions).

---

## 6. Test plan

- `npx tsc --noEmit`, `npm run lint`, `npm test` after every phase (`case-access.test.ts` must be rewritten to drop the milling mock).
- Add/keep unit tests: status transitions (design_only only), invoice totals before/after, price-list single-catalog, sign-up without service step.
- Manual: client sign-up → admin approval → price list shows once → create single + bulk + 3Shape-import case → QC approve → client approves → invoice → case sheet.
- Verify these URLs 404: `/milling`, `/api/milling/*`, `/admin/milling/*`, `/api/admin/milling/*`, `/api/cases/:id/milling-assign`, `/api/cases/:id/design-assign`.
- Verify a `milling_admin` account can no longer sign in (account removed).
- `grep -rniE "milling|design_milling|milling_only|designPartner|design_partner" src scripts` returns only the legacy-label fallback and migration history.

---

## 7. Suggested PR split

1. Phase 1 (+ Phase 2 script, not run) — "stop new milling cases".
2. Phase 3 — delete portal/API/components.
3. Phase 4 — lifecycle collapse.
4. Phase 5 — pricing/billing collapse.
5. Phase 6 — docs.
6. Phase 7 — destructive migration, shipped after a release of soak time.

---

## 8. File checklist (deletions)

```
src/app/milling/**                              src/app/api/milling/**
src/app/admin/(dashboard)/milling/**            src/app/api/admin/milling/**
src/app/api/cases/[id]/milling-assign/          src/app/api/cases/[id]/design-assign/
src/app/api/admin/clients/[id]/service-types/   src/app/api/client/service-types/
src/components/AssignMillingCenterDialog.tsx    src/components/AssignDesignPartnerDialog.tsx
src/components/MillingLayout.tsx                src/components/MillingServiceCatalogTable.tsx
src/components/MillingSidebar.tsx               src/components/MillingStatusBadge.tsx
src/lib/milling/**  (after moving admin-guard) src/db/schema/milling.ts  (Phase 7 schema step)
scripts/seed-milling-only-catalog.mjs           scripts/backfill-milling-only-data.ts
src/app/api/admin/user/Untitled-1.md
```

## 9. Audit queries to run before Phase 2

```sql
SELECT service_type, status, count(*) FROM cases GROUP BY 1,2 ORDER BY 1,2;
SELECT count(*) FROM milling_centers;
SELECT role, count(*) FROM profiles WHERE user_type = 'milling_portal' GROUP BY 1;
SELECT service_type, count(*) FROM service_catalog GROUP BY 1;
SELECT sc.service_type, count(*) FROM client_price_list cp JOIN service_catalog sc ON sc.id = cp.catalog_item_id GROUP BY 1;
SELECT enabled_service_types, count(*) FROM profiles WHERE role IN ('client') GROUP BY 1;
SELECT count(*) FROM invoices WHERE line_items::text ~ 'design_milling|milling_only';
SELECT count(*) FROM notifications WHERE link LIKE '/milling/%';
```
