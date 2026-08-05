# Implementation Plan — Milling Only Flow (service catalog + status mapping)

Synced from `service-catlog-manage-plan.md` + `plan.md`. Branch: `phase2`.

Verified against current code (2026-08-05):
- `serviceTypeEnum` = `['design_only', 'design_milling']` today — no `milling_only`.
- `caseStatusEnum` and all lifecycle/label maps in `src/db/schema/case.ts` **already** cover every milling-pipeline status (`ready_for_milling` … `dispatched`) — no enum change needed there.
- `profiles` has no `enabledServiceTypes` column yet.
- `mergeByServiceType` in `src/lib/price-list-shared.ts` is a hardcoded 2-way merge (`designOnly`/`designMilling` fields) — extending to 3 is a reshape, not just a union widening.
- Latest migration is `0046_milling_schema.sql` → next is `0047`.
- `src/lib/case-status-mapping.ts` and `src/lib/case-status-transitions.ts` don't exist yet — genuinely new files.
- Per `AGENTS.md`: before writing any App Router route handler / page code, check `node_modules/next/dist/docs/` for this project's Next.js conventions — do not assume standard Next.js behavior.

Each phase is small and independently testable (typecheck + manual smoke). Work through them in order — later phases depend on earlier ones. Check items off as we go.

---

## Phase 1 — Schema + Migration ✅ DONE

- [x] 1.1 `src/db/schema/case.ts`: add `'milling_only'` to `serviceTypeEnum`.
- [x] 1.2 `src/db/schema/price-list.ts`: add `isEnabled: boolean('is_enabled').default(true).notNull()` to `clientPriceList`.
- [x] 1.3 `src/db/schema/profile.ts`: add `enabledServiceTypes: text('enabled_service_types').array().notNull().default(sql\`'{design_only}'::text[]\`)` to `profiles`.
- [x] 1.4 Wrote migration `src/db/migrations/0047_service_catalog_flows.sql`:
  - add `'milling_only'` to the Postgres `service_type` enum
  - add `is_enabled` column to `client_price_list`
  - add `enabled_service_types` column to `profiles`
  - backfill existing clients' `enabled_service_types` to `{design_only,design_milling}`
  - **Deviation from original plan:** catalog seeding is NOT inline in this migration. Postgres forbids using an enum value added by `ALTER TYPE ... ADD VALUE` within the same transaction that added it, and `scripts/migrate.mjs` batches all pending migrations into one transaction — so seeding `milling_only` rows here would break on any from-scratch deploy. Moved to a standalone script instead.
  - New `scripts/seed-milling-only-catalog.mjs` (run via `npm run db:seed-milling-only-catalog`): seeds one `milling_only` row per existing `category`/`subCategory`, `is_active = false`. Must be run once, after the migration has committed.
- [x] 1.5 Ran `npm run db:migrate` then `npm run db:seed-milling-only-catalog` against the dev DB. Verified directly in Postgres: enum has all 3 values, both new columns present with correct defaults, all 3 existing clients backfilled to `{design_only,design_milling}`, 23 `milling_only` catalog rows seeded inactive. `tsc --noEmit` clean.

**Checkpoint met:** typecheck passes, migration applies cleanly, no app code touched yet.

---

## Phase 2 — Flow-aware status mapping module (new) ✅ DONE

- [x] 2.1 Created `src/lib/case-status-mapping.ts`: `ServiceType`, `StatusViewer` types, `STATUS_MAPPING` const for all 3 flows per §5–§7 of `plan.md`, plus helpers `getStatusLabel`, `getLifecycleSteps`, `getLifecycleStep`, `isStatusAllowedForFlow`, `getSkippedStatuses`.
- [x] 2.2 Unknown/legacy status → fallback to raw status string (verified, doesn't throw).

**Checkpoint met:** pure module, no callers yet. Ran a scratch `tsx` script exercising all 3 flows' lifecycle steps/skipped statuses and spot-checked labels (admin + client) against the tables in `plan.md` §5–§7 — all matched. `tsc --noEmit` clean.

---

## Phase 3 — Transition guard (new) ✅ DONE

- [x] 3.1 Created `src/lib/case-status-transitions.ts`: `canTransitionCaseStatus(...)`, `getAllowedTargetStatuses(...)` per `plan.md` §10.
  - **Scope note:** `src/app/api/cases/[id]/route.ts` already has quite intricate per-role, per-field transition logic (QC self-assignment, output-file gating tied to specific profile IDs, etc.) that goes beyond a simple status-graph check. This guard is intentionally coarser — it encodes only the *new* cross-cutting rules the 3-flow model introduces (flow validity, clients can't set production statuses, design_milling requires approval before production, milling roles can only set production statuses). It's meant to be layered on top of the existing route logic as an extra check during Phase 9 wiring, not to replace it wholesale in this phase.
  - Milling-portal "only act on assigned case" rule needs a `millingCaseAssignments` join not available to this pure function — left as a caller responsibility, documented in the module.
- [x] 3.2 No callers wired yet. Ran scratch `tsx` checks: milling_only rejects `allocated_to_designer`; design_only rejects `ready_for_milling`; design_milling blocks production before `approved` and allows it after; milling_only allows production right after `scan_verified`; clients blocked from production statuses; milling roles blocked from design statuses. All matched expected behavior.

**Checkpoint met:** zero behavior change in the running app — `tsc --noEmit` clean, no route files touched.

---

## Phase 4 — Server pricing/invoice libraries ✅ DONE

- [x] 4.1 `src/lib/price-list-shared.ts`: widened `PriceListEntryFull` (`isActive`, `isEnabled`), reshaped `mergeByServiceType` to take 3 inputs (third optional, defaults to `[]`) and `MergedPriceRow` to carry a `millingOnly` side alongside `designOnly`/`designMilling`. `MergedPriceRowSide` also gained `isActive`/`isEnabled`.
- [x] 4.2 `src/lib/price-list.ts`: widened unions to include `milling_only` (new `CatalogServiceType` export) in `getPriceListForClient`/`getServiceCatalog`; added `includeInactive` param to both; added `updateCatalogActiveStatus`; added `isEnabled` support to `updateClientPriceList`; added `getClientEnabledServiceTypes`/`setClientEnabledServiceTypes` (thin wrappers over `profiles.enabledServiceTypes`).
- [x] 4.3 `src/lib/invoice.ts`: widened `serviceType` unions in `getUnitPrice`, `buildInvoiceItems`, `modelCountByServiceType` (via new `CaseServiceType`/`resolveServiceType`); added `(Milling Only)` description suffix via new `serviceTypeSuffix` helper. Also widened `InvoiceLineItem.serviceType` in `src/db/schema/invoice.ts`.
  - Bug caught in review: the old inline ternary (`c.serviceType === 'design_milling' ? 'design_milling' : 'design_only'`) would have silently collapsed `milling_only` cases into `design_only` pricing. Replaced with an explicit `resolveServiceType()` that checks all 3 values.

**Checkpoint met:** `tsc --noEmit` clean. Manual smoke test (`tsx` script against the real dev DB, no test suite exists in this repo) confirmed: `getServiceCatalog('milling_only', true)` returns the 23 seeded inactive rows with correct `isActive`/`isEnabled`; `getPriceListForClient(clientId, 'design_only')` still returns the expected 23 rows; `buildInvoiceItems` against 3 real `design_only` cases produced the exact same line items/subtotal as before the change — no regression.

---

## Phase 5 — Admin APIs ✅ DONE

- [x] 5.1 `src/app/api/admin/service-catalog/route.ts`: accepts `milling_only`, `?includeInactive=true` on GET, PUT body accepts optional `isActive` per item (calls new `updateCatalogActiveStatus`), PUT now also reads `?serviceType=` to return the right tab's data.
- [x] 5.2 `src/app/api/admin/clients/[id]/price-list/route.ts`: accepts `milling_only`, `?includeInactive=true`, `isEnabled` in PUT body, invalidates all 3 Redis cache keys, PUT response now includes `millingOnlyData`.
- [x] 5.3 New `src/app/api/admin/clients/[id]/service-types/route.ts` (GET/PUT `profiles.enabledServiceTypes`, validates ≥1 flow stays enabled with a 400, `client.service_types_updated` activity-log entry).
- [x] 5.4 New `src/app/api/client/service-types/route.ts` (GET only, client-facing, uses `resolveClientIdFromProfile` so subusers inherit their parent client's flows).
- [x] 5.5 (Added, not in original plan) New `parseCatalogServiceType()` helper in `price-list.ts` — the existing 2-value inline ternary pattern (`serviceType === 'design_milling' ? ... : 'design_only'`) was duplicated across 6 files and silently collapses `milling_only` into `design_only`. Fixed it at the 3 read sites touched in this phase (`admin/service-catalog`, `admin/clients/[id]/price-list`, `client/price-list`). **Still broken** at 3 more sites out of this phase's scope — tracked below so they aren't lost:
  - `src/app/api/cases/route.ts` (POST, case creation) — **critical**, must fix in Phase 7/9 or clients can never actually create a `milling_only` case even once the UI offers it.
  - `src/app/api/billing/clients/[clientId]/route.ts` — tracked in Phase 10.
  - `src/app/api/admin/invoices/[id]/case-sheet/route.ts` — tracked in Phase 10.

**Checkpoint met:** `tsc --noEmit` clean; `eslint` on all touched files shows only 4 pre-existing errors in `invoice.ts` (confirmed via `git stash` diff — same errors, same content, predate this work). Manual `tsx` smoke test against the real dev DB: `getClientEnabledServiceTypes`/`setClientEnabledServiceTypes` round-trip correctly, empty-array rejection works, `updateCatalogActiveStatus` correctly toggles and reverts a `milling_only` catalog row's `isActive`. DB state restored to pre-test values after the test.

---

## Phase 6 — Admin UI ✅ DONE (code + typecheck/lint verified; browser click-through NOT possible in this sandbox)

- [x] 6.1 `PriceListTable.tsx`: **redesigned rather than reshaped** — the plan's own tab design (one flow per tab) means each tab only ever needs single-flow rows, not the old 2-way merged multi-column row. So the component now takes flat `PriceListEntryFull[]` rows + a `mode: 'system' | 'client'` prop instead of a `columns` config, using the `isActive`/`isEnabled` fields Phase 4 added. `mode="system"`: Service | Unit | Enabled (toggle) | Default Price. `mode="client"`: Service | Unit | Default Price (ref) | System Enabled (ref badge) | Client Enabled (toggle) | Client Price — row visually locked/greyed when system `isActive` is false.
  - This API change had a blast radius beyond this phase's file list: `ClientPriceListModal.tsx` (Phase 7 territory) also consumes `PriceListTable` and broke immediately. Fixed it now rather than leaving the build broken — see note under Phase 7 below.
- [x] 6.2 `admin/(dashboard)/profile/page.tsx`: 3-tab Default Price List (`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`), 3 parallel `useQuery`s (one per flow, `includeInactive=true`), edit modal now also has a per-row Enabled toggle alongside price, save button enabled by either price or enabled-state changes, PUT now includes `isActive` per item.
- [x] 6.3 `admin/(dashboard)/clients/[id]/page.tsx`: new "Enabled Flows" card (3 switches wired to `GET/PUT /api/admin/clients/[id]/service-types`, blocks disabling the last flow client-side with a toast — server also enforces this), 3-tab Allocated Price List with the amber "not enabled for this client" banner per tab from §5B, system/client enabled-state + price columns via `PriceListTable mode="client"`.

**Checkpoint:** `tsc --noEmit` clean; `eslint` on all 6 touched files shows only pre-existing errors (confirmed via `git stash` diff, same as Phase 4/5). Started the dev server (`npm run dev`) and confirmed: Next.js boots cleanly (Redis connection errors in the log are this sandbox having no network access to Upstash — unrelated background workers, not page-rendering); the new/modified API routes (`/api/client/service-types`, `/api/admin/service-catalog`) compile and execute, returning `401 Unauthorized` as expected for an unauthenticated request; `/admin/profile` and `/admin/clients` correctly redirect to login (auth middleware). **Could not** log in and click through the actual 3-tab UI, toggle switches, or verify visual layout — no admin credentials available in this sandbox. This is a real gap: the UI code compiles and the logic was written carefully against the same `PriceListEntryFull` shape already verified live in Phase 4/5, but it has not been eyeballed in a browser. Recommend a manual pass before shipping.

---

## Phase 7 — Client UI ✅ DONE (code + typecheck/lint verified; browser click-through NOT possible in this sandbox)

- [x] 7.1 `src/components/AddCaseDialog.tsx`: fetches `enabledServiceTypes` (client's own via `/api/client/service-types`, or admin's selected-client via `/api/admin/clients/[id]/service-types`, refetched whenever `selectedClientId` changes), RadioGroup renders only enabled flows and is skipped entirely when only one is enabled, added Milling Only card + mill-ready-file dropzone copy, `serviceType` auto-corrects if it falls outside the enabled set (e.g. admin switches to a client with fewer flows).
  - **Also fixed `src/app/api/cases/route.ts` POST** (flagged in Phase 5): it was silently coercing any non-`design_milling` serviceType to `design_only` on every case creation — would have eaten `milling_only` submissions even with the UI fixed. Replaced with `parseCatalogServiceType`. **Also added a server-side gate** (not just client-side UI filtering): the route now rejects case creation with a 400 if the submitted `serviceType` isn't in the client's `enabledServiceTypes` — the plan's acceptance criteria require this enforced server-side, not just hidden in the UI.
**Checkpoint met (partial):** `tsc --noEmit` clean; `eslint` on `AddCaseDialog.tsx`/`cases/route.ts` shows only pre-existing errors (confirmed via `git stash` diff — 2 new `react-hooks/set-state-in-effect` hits from the new fetch effects were suppressed inline with justification comments, matching the same rule's existing suppression pattern already used elsewhere in this codebase, e.g. `clients/[id]/page.tsx`). Could not create an actual `milling_only` test case end-to-end (no admin/client credentials in this sandbox) — logic was verified by code review against the exact same request/response shapes already confirmed live in Phase 4/5.

- [x] 7.2 `ClientPriceListModal.tsx`: **done early**, during Phase 6 (its `PriceListTable` dependency changed shape and broke the build, so fixing it couldn't wait). Now takes `rowsByFlow: Partial<Record<ServiceType, PriceListEntryFull[]>>`, renders tabs only for flows present in that map (single un-tabbed table if only one), each caller must pre-filter to `isActive && isEnabled`. Caller (`client/(dashboard)/profile/page.tsx`) rewired: fetches `GET /api/client/service-types`, fetches price list per enabled flow via `fetchPriceListWithCache` (now widened to accept `milling_only`), filters to `isEnabled` (the API already only returns `isActive` rows by default). Not yet browser-verified — same caveat as Phase 6.
- [x] 7.3 **Corrected, moved to Phase 8**: the file named here (`src/app/client/cases/[id]/page.tsx`) doesn't exist — the real path is `src/app/client/(dashboard)/cases/[id]/page.tsx`, and it doesn't render its own lifecycle bar; it delegates entirely to the shared `src/components/CaseDetailView.tsx` (used by both admin and client case-detail pages). That's exactly Phase 8's job ("wire status mapping module into existing surfaces"), which already lists `CaseDetailView.tsx` — doing it here would either duplicate Phase 8 or touch the shared component prematurely, half-scoped to only the client path. Deferred to Phase 8.

**Checkpoint:** as a test client with only Design Only enabled, confirm case submission shows no radio group; enable Milling Only for that client and confirm the 3rd option + copy appears.

---

## Phase 8 — Wire status mapping module into existing surfaces ✅ DONE (code + typecheck/lint verified; browser click-through NOT possible in this sandbox)

Replaced direct usage of the old global maps (`CLIENT_STATUS_LABELS`, `INTERNAL_STATUS_LABELS`, `CASE_STATUS_TO_LIFECYCLE_STEP`) with the Phase 2 module, passing `serviceType` through:

- [x] 8.1 `src/components/StatusBadge.tsx`: accepts optional `serviceType`; when present, uses `getStatusLabel` instead of the global maps. Optional and backward-compatible — callers that don't pass it keep today's exact behavior.
- [x] 8.2 `src/components/CaseDetailView.tsx`: `LifecycleStrip` now takes `serviceType` and uses `getLifecycleSteps`/`getLifecycleStep` instead of the global `CASE_LIFECYCLE_STEPS`/`CASE_STATUS_TO_LIFECYCLE_STEP`. **Intentional behavior change for design_milling** (not a regression, this is what `plan.md` §6 specifies): Packaging/Dispatched/Delivered are now distinct progress-bar steps instead of all bucketed under "In Production" as before. design_only's steps/labels are byte-for-byte identical to the old behavior (verified in Phase 2's sanity check). Milling tab visibility (`hasMillingTab`) now also covers `milling_only`, not just `design_milling`, per §7A.
- [x] 8.3 `src/app/admin/(dashboard)/cases/page.tsx`: service-type-aware badges (2 call sites), added `milling_only` filter option, milling-centre indicator icon now shows for `milling_only` too. **Fixed a real pre-existing bug**: the service-type filter used `serviceType === 'design_milling' ? match : !match` — so selecting "Design Only" in the filter also matched every `milling_only` case (anything that wasn't `design_milling`). Replaced with an exact-match comparison.
- [x] 8.4 `src/app/(ops)/cases/page.tsx` (confirmed still active — `OpsSidebar`/`OpsLayout` route real staff roles here): same badge update, widened `serviceType` type.
- [x] 8.5 `src/app/admin/(dashboard)/dashboard/page.tsx`: reviewed — left unchanged. Its "Recent Activity" widget's data (`act: any`) doesn't carry `serviceType` from its summary API, and every status shown there has identical labels across flows anyway, so there's no behavior to fix and no regression risk in leaving it on the global-map fallback.
- [x] 8.6 `src/app/client/(dashboard)/cases/page.tsx`: badge updated. **Scope correction, done anyway**: this file was assumed to just need badge/filter wiring, but it turned out to contain a second, entirely separate case-submission form (single + bulk upload) — not a delegate to `AddCaseDialog.tsx`. `AddCaseDialog.tsx` (fixed in Phase 7) is only ever rendered from the **admin** cases page. This file is the actual client self-service submission path, and it still had the old hardcoded 2-option service type UI. Fixed properly: fetches `/api/client/service-types` on mount, RadioGroup (single-case form) and Select (bulk-row form) now render only enabled flows and include Milling Only, dropzone copy changes for `milling_only`, new bulk rows default to the client's first enabled flow instead of a hardcoded `design_only`.
- [x] 8.7 `src/app/client/(dashboard)/dashboard/page.tsx`: reviewed — left unchanged, same reasoning as 8.5 (no `serviceType` in the summary data, identical labels across flows for the statuses shown there).
- [x] 8.8 `src/app/api/admin/analytics/delivery-status/route.ts`: flow-aware bucketing via new `bucketFor(status, serviceType)`. **Fixed two real bugs, not just added flow-awareness**: (1) `approved` was bucketed as "Completed" for every case, but for `design_milling`/`milling_only` a case that's merely `approved` hasn't shipped yet — now only `design_only` counts `approved` as complete, others bucket it as "In Production". (2) the milling-pipeline statuses (`ready_for_milling` through `dispatched`) had **no bucket at all** and were silently dropped from every total, undercounting `design_milling` case counts already, before this plan even existed — now split into "In Production"/"Packaging"/"Dispatched" buckets.
- [x] 8.9 `src/lib/notifications/notification-dispatcher.ts`: `notifyCaseStatusChanged` gained an optional `serviceType` param, uses `getStatusLabel(..., 'client')` for the notification message instead of a crude `status.replace(/_/g, ' ')` (e.g. `milling_only`'s `scan_received` now correctly reads "File Submitted" instead of "scan received" verbatim). Wired all 3 callers (`cases/[id]/route.ts`, `cases/[id]/approval-checklist/route.ts`, `cases/bulk/confirm/route.ts`) to pass `caseRecord.serviceType`.

**Checkpoint met:** `tsc --noEmit` clean across the whole project; `eslint` on every touched file shows only pre-existing warnings/errors (no new ones, spot-checked via `git diff`). Ran a scratch `tsx` script re-implementing `bucketFor` to confirm the analytics bucketing logic against all 3 flows. Could not click through the actual UI (case lists, lifecycle bar, notifications) in a browser — same sandbox limitation as Phases 6-7. design_only rendering was specifically checked against Phase 2's already-verified label/step output to confirm no regression.

---

## Phase 9 — Milling Only case flow wiring ✅ DONE (code + typecheck/lint verified; live end-to-end walk NOT possible in this sandbox)

- [x] 9.1 **Corrected file target**: `src/app/admin/cases/[id]/page.tsx` doesn't exist and its would-be content (`src/app/admin/(dashboard)/cases/[id]/page.tsx`) is a 17-line wrapper that delegates entirely to `CaseDetailView.tsx` — which, for the admin viewer, only renders a thin "change_requested accept/decline" action panel. The **real** interactive designer/QC assignment UI (`AllocateMenu`, "Assign QC", "Send to QC", the internal_qc approve/reject buttons) and the "Select Milling Centre" button all live in `src/app/admin/(dashboard)/cases/page.tsx` (the cases **list**, in an expandable row-actions section), which had zero `serviceType` awareness before this phase. Fixed there instead:
  - Wrapped the 3 `AllocateMenu` (designer-assignment) render sites — at `scan_received`, `scan_not_verified`, and the `scan_verified`/`allocated_to_designer`/`in_progress` block — and the QC-assignment/Send-to-QC branch in `caseItem.serviceType !== "milling_only" &&` guards, so milling_only cases never show designer/QC UI (design_only/design_milling behavior is untouched — these guards only ever evaluate `false` for those flows, changing nothing).
  - Widened the "Select Milling Centre" button condition from `status === 'approved' && serviceType === 'design_milling'` to also fire at `status === 'scan_verified' && serviceType === 'milling_only'`.
  - The `on_hold` block's `AllocateMenu` (resume-and-reassign) got the same `!== "milling_only"` guard.
- [x] 9.2 `src/app/api/cases/[id]/milling-assign/route.ts`: `getDesignMillingCase` (design_milling only) → `getMillableCase` (design_milling OR milling_only); flat `ASSIGNABLE_STATUSES` set → flow-aware `isAssignableStatus(serviceType, status)` — design_milling still requires `approved`, milling_only now allows assignment right after `scan_verified`, both allow re-assignment from any production status. Error messages updated to not say "Design + Milling" when the case is actually Milling Only.
- [x] 9.3 Wired the Phase 3 guard into `src/app/api/cases/[id]/route.ts` (the main status-update route) as a single early check right after body parsing, before the existing intricate per-role logic — rejects with 403 before any role branch runs if the flow-level rule fails. **Did not** wire it into `milling-assign/route.ts` (already got its own flow-aware `isAssignableStatus` check in 9.2, which is more precise than the generic guard for this specific action) or `milling/cases/[id]/status/route.ts` (reviewed — already structurally safe: its status input is validated against `millingStatusEnum`, a 6-value enum containing only production statuses, so it can never accept a design-stage status regardless; and it already scopes updates to `millingCaseAssignments` rows joined on the calling centre's own `millingCenterId`, which is exactly the "only assigned cases" rule Phase 3's docstring flagged as needing enforcement elsewhere).

**Checkpoint met:** `tsc --noEmit` clean; `eslint` shows only pre-existing warnings. Verified with two scratch `tsx` scripts: (1) `isAssignableStatus` — design_milling blocked at `scan_verified`, allowed at `approved`; milling_only allowed at `scan_verified`, blocked at `approved` (unreachable status for that flow anyway); both allowed at every production status for re-assignment. (2) `canTransitionCaseStatus` replayed against 8 real transitions taken from the actual client/qc/admin branches read in `cases/[id]/route.ts` — all 8 still return `allowed: true`, confirming the new guard introduces zero regression for existing design_only/design_milling flows. Could not create a real milling_only case end-to-end and click through scan_verified → assign → production → delivered in a browser — no credentials in this sandbox (same limitation as Phases 6-8).

---

## Phase 10 — Billing/invoice surfaces ✅ DONE

- [x] 10.1 `src/app/api/billing/clients/[clientId]/route.ts`: widened `computeCasePrice`'s `serviceType` union to 3 values. **Fixed the same bug class again** (4th occurrence, after `invoice.ts` in Phase 4, `cases/route.ts` POST in Phase 7, and the query-param parser in Phase 5) — the naive `c.serviceType === 'design_milling' ? 'design_milling' : 'design_only'` ternary would have silently priced every `milling_only` case as `design_only`. Replaced with an explicit 3-way check. The catalog/client-price queries feeding `buildPriceMap` were already flow-agnostic (select all rows, no serviceType filter), so no change needed there.
- [x] 10.2 `src/app/api/admin/invoices/[id]/case-sheet/route.ts`: same fix applied to `extractCaseRow`'s `serviceType` resolution (identical bug pattern); `CaseRow.serviceType` type widened; CSV "Service Type" column now emits "Milling Only" alongside the existing "Design"/"Design + Milling" values.
- [x] 10.3 Could not generate a real invoice through the UI (auth-gated, no credentials in this sandbox). Instead ran a scratch `tsx` script reproducing `buildPriceMap`/price-resolution logic directly against the real dev DB: confirmed `design_only`/`design_milling` Crown & Bridge pricing is unchanged (both return $4, matching Phase 4's earlier invoice smoke test), and `milling_only` correctly resolves to `$0` rather than crashing or silently reusing `design_only`'s price — expected, since Milling Only catalog rows are still seeded inactive/unpriced by design until an admin turns them on (Phase 1).

**Checkpoint met:** `tsc --noEmit` clean; `eslint` shows only the one pre-existing `prefer-const` error (confirmed via `git stash`, same line content, just shifted by the new line inserted above it).

---

## Phase 11 — Final verification ✅ DONE

- [x] 11.1 Full production build (`npm run build`, Next.js/Turbopack): **exit code 0**, all 115 routes compiled/prerendered successfully, no "Failed to compile" / "Type error" / "Module not found" anywhere in the log. (The Redis `ENOTFOUND stunning-squid-84087.upstash.io` lines throughout the log are this sandbox having no network access to Upstash — unrelated background worker noise, not build errors; every route that touches Redis already handles connection failure gracefully.) This is a stronger check than `tsc --noEmit` alone — it also validates server/client component boundaries and bundler-level resolution across the whole app, not just types.
- [x] 11.2 No test runner exists in this repo (confirmed in Phase 1 — no `package.json` test script, no jest/vitest config, no `*.test.*` files anywhere), so no test suite to run and no established test convention to add coverage into. In its place: every phase in this document was verified with `tsc --noEmit`, `eslint` (with an explicit pre-existing-vs-new error diff via `git stash` at every step — final aggregate check: 17 errors/36 warnings before this work touched these files vs. 16 errors/37 warnings after, i.e. net **fewer** errors, not more), and scratch `tsx` scripts exercising the real logic against the live dev DB wherever auth didn't block it (Phases 1, 2, 3, 4, 5, 9, 10).
- [x] 11.3 Re-checked every item:
  - **`service-catlog-manage-plan.md` §9 Open Assumptions** — all 5 hold: no client design-approval step for Milling Only (only hold/cancel client actions exist for that flow); new clients default to `{design_only}`, existing clients backfilled to `{design_only, design_milling}` (Phase 1, verified live); system `isActive=false` always overrides client `isEnabled=true` (client-facing routes default `includeInactive=false`, and `PriceListTable`'s `mode="client"` visually locks system-disabled rows regardless of the client toggle); Milling Only catalog rows seeded `isActive=false` (Phase 1, verified 23 rows); disabling a service never retroactively affects existing cases/invoices (`getUnitPrice`/`buildInvoiceItems`/`buildPriceMap` never check `isActive` — only case-submission (Phase 7 gate) and price-list display (`includeInactive`) do).
  - **`plan.md` §13 Acceptance Criteria** — all hold: flow-aware admin/client labels (Phase 8); no milling-centre identity leaked to clients (pre-existing `clientHidden`/`clientLabel` redaction on timeline events, untouched by this work); Milling Only uses file/production language (Phase 2's sanity check output); Design Only terminates at `approved`, Design + Milling continues through production to `delivered`, Milling Only skips every design-stage status (all three verified via the Phase 2/3 scratch scripts); lifecycle bars are flow-specific via `getLifecycleSteps` (Phase 8); client service-type choices and price-list tabs limited to enabled flows (Phase 7, both `AddCaseDialog.tsx` and the actual client-facing form in `client/(dashboard)/cases/page.tsx`); client price-list rows hide system- and client-disabled services (verified single consumer of the client price-list API already filters both); API rejects invalid transitions per flow (Phase 3 guard wired into the live route in Phase 9, replayed against 8 real transitions with zero false rejections); historical cases still render regardless of later-disabled services (unknown-status fallback in `case-status-mapping.ts`, `isActive` never gates historical pricing).

**Checkpoint met.** All 11 phases complete.

---

## Notes while implementing

- Before writing any new/changed route handler or page in `src/app/**`, check `node_modules/next/dist/docs/` (per `AGENTS.md`) — this project's Next.js may diverge from standard conventions.
- Disabling a service/flow must never retroactively affect existing cases or invoice math — only gates new submissions and price-list visibility going forward.
- System-level `isActive = false` always overrides client-level `isEnabled = true`.