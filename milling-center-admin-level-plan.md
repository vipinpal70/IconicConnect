# Milling Center — Admin-Level Onboarding & Service Catalog Plan

Scope: **admin interface only**. No milling-portal-side changes in this plan. This extends the milling center feature that already exists in the codebase (`src/db/schema/milling.ts`, `/api/admin/milling/centers/**`, `/admin/milling/centers`) rather than building a parallel system.

---

## 0. What already exists today (don't rebuild this)

| Piece                                                             | File                                                                                      | Status                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `millingCenters` table                                            | `src/db/schema/milling.ts:29-42`                                                          | `id, name, contactName, email, phone, city, state, country, active, onboardedAt, createdAt, updatedAt`                                                      |
| `millingServiceCatalog` table                                     | `src/db/schema/milling.ts:44-66`                                                          | `id, millingCenterId, category, subCategory, unitType, partnerRate, turnaroundDays, isActive, notes` — **exists in DB but has zero API routes or UI today** |
| List/create centers                                               | `src/app/api/admin/milling/centers/route.ts`                                              | `GET` (list), `POST` (create + optional first `milling_admin` login via `createMillingUser`)                                                                |
| Get/edit/deactivate center                                        | `src/app/api/admin/milling/centers/[id]/route.ts`                                         | `GET`, `PATCH` (edit fields or toggle `active`), `DELETE` (soft — sets `active=false`, never hard-deletes)                                                  |
| Centers table + onboarding dialog                                 | `src/app/admin/(dashboard)/milling/centers/page.tsx`                                      | Single-step `Dialog`, flat `emptyForm` object, `Field` helper, `Switch` for active toggle                                                                   |
| Manage users dialog                                               | `src/app/admin/(dashboard)/milling/_components/ManageUsersDialog.tsx`                     | Secondary dialog per center row — add/reset/delete milling logins                                                                                           |
| Auth guard                                                        | `src/lib/milling/admin-guard.ts`                                                          | `requireAdmin()` / `requireStaffRole(roles)` — **use these, don't write a new local guard**                                                                 |
| Sub-nav                                                           | `src/app/admin/(dashboard)/milling/_components/MillingSubNav.tsx`                         | Tabs: Centres / Overview / Routing / Analytics                                                                                                              |
| Global service catalog (client-facing) pattern to copy for the UI | `src/app/admin/(dashboard)/profile/page.tsx:32-260` + `src/components/PriceListTable.tsx` | 3-tab (`design_only`/`design_milling`/`milling_only`) tabbed table, `overrides` dict pattern, batch `PUT` save                                              |
| `serviceTypeEnum` (already has all 3 values applied)              | `src/db/schema/case.ts:40`                                                                | `pgEnum('service_type', ['design_only', 'design_milling', 'milling_only'])`                                                                                 |

**Field mapping decision** (important): the existing `millingCenters.contactName` / `.email` / `.phone` columns are re-purposed as the **POC** in the new step-1 form — they're already used today as "the person who gets the login." No need for separate `pocName/pocEmail/pocPhone` columns; the form just relabels these three inputs as "POC name / POC email / POC phone" and keeps wiring the login-creation flow (`createMillingUser`) off `email`. This avoids a duplicate/confusing pair of "contact" fields on the same row.

Everything else the user asked for (legal name, contract doc, lab owner, finance POC, states served, avg TAT, monthly capacity, per-flow service catalog with enable toggle) is genuinely new — confirmed via repo-wide grep, nothing to reuse.

---

## 1. Data model changes

### 1A. Extend `millingCenters` (`src/db/schema/milling.ts`)

New columns, step-1 fields:

```ts
export const millingCenters = pgTable("milling_centers", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: varchar("name", { length: 150 }).notNull(), // Company name
	legalName: varchar("legal_name", { length: 200 }), // NEW — Company legal name
	contactName: varchar("contact_name", { length: 100 }), // = POC name (existing, relabeled)
	email: varchar("email", { length: 255 }), // = POC email (existing, relabeled) — used for login
	phone: varchar("phone", { length: 20 }), // = POC phone (existing, relabeled)

	// NEW — Lab owner
	ownerName: varchar("owner_name", { length: 100 }),
	ownerEmail: varchar("owner_email", { length: 255 }),
	ownerPhone: varchar("owner_phone", { length: 20 }),

	// NEW — Finance POC
	financePocName: varchar("finance_poc_name", { length: 100 }),
	financePocEmail: varchar("finance_poc_email", { length: 255 }),
	financePocPhone: varchar("finance_poc_phone", { length: 20 }),

	// NEW — Contract document (single doc for MVP; see §3 for why not a table)
	contractDocKey: text("contract_doc_key"), // raw R2 object key
	contractDocName: varchar("contract_doc_name", { length: 255 }),
	contractDocUploadedAt: timestamp("contract_doc_uploaded_at"),

	city: varchar("city", { length: 100 }), // City / HQ (existing, unchanged)
	state: varchar("state", { length: 100 }),
	country: varchar("country", { length: 100 }),

	// NEW — step-2
	statesServed: text("states_served").array(), // e.g. ['CA','NY'] or ['ALL']
	avgTatDays: integer("avg_tat_days"), // NEW — Avg TAT (days)
	enabledServiceTypes: text("enabled_service_types") // NEW — which of the 3 flows this centre offers
		.array()
		.notNull()
		.default(sql`'{}'::text[]`),

	active: boolean("active").default(true).notNull(),
	onboardedAt: date("onboarded_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

Notes:

- `statesServed` follows the exact `fromCsv`/`toCsv` convention already used for `millingRoutingRules.scope.states` in `src/app/admin/(dashboard)/milling/routing/_components/RoutingRuleDialog.tsx:44-46` — comma-separated input in the UI, `text[]` in the DB. A literal `['ALL']` array is the sentinel for "all states," checked in code as `statesServed.includes('ALL')` rather than a separate boolean, to keep it a single field like the user described ("comma-sep or ALL").
- `enabledServiceTypes` mirrors `profiles.enabledServiceTypes` (`src/db/schema/profile.ts`) — a `text[]`, not a Postgres array-of-enum, consistent with how the codebase already does this elsewhere. Values are the same three strings as `serviceTypeEnum`.
- `legalName` nullable — only `name` (company name) stays required, matching the existing `POST` validation (`centers/route.ts:32-34`).

### 1B. Extend `millingServiceCatalog` (`src/db/schema/milling.ts`)

This table already has almost everything needed (`category`, `subCategory`, `unitType`, `partnerRate`, `turnaroundDays`, `isActive`) but is missing two things the user asked for: which of the 3 flows a row belongs to, and monthly capacity.

```ts
export const millingServiceCatalog = pgTable(
	"milling_service_catalog",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		millingCenterId: uuid("milling_center_id")
			.references(() => millingCenters.id, { onDelete: "cascade" })
			.notNull(),
		serviceType: serviceTypeEnum("service_type").notNull(), // NEW — design_only | design_milling | milling_only (which tab)
		category: varchar("category", { length: 100 }).notNull(),
		subCategory: varchar("sub_category", { length: 100 }).notNull(), // "service name" in the UI
		unitType: unitTypeEnum("unit_type").notNull(),
		partnerRate: numeric("partner_rate", { precision: 10, scale: 2 }).notNull(), // "price"
		monthlyCapacity: integer("monthly_capacity"), // NEW — nullable = no cap set
		turnaroundDays: integer("turnaround_days"),
		isActive: boolean("is_active").default(true).notNull(), // the enable/disable toggle
		notes: text("notes"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => ({
		millingCenterIdIdx: index("milling_service_catalog_center_id_idx").on(
			table.millingCenterId,
		),
		centerServiceTypeCategoryUniq: unique(
			"milling_service_catalog_center_type_category_uniq",
		).on(
			table.millingCenterId,
			table.serviceType,
			table.category,
			table.subCategory,
		),
	}),
);
```

Needs `import { serviceTypeEnum } from './case'` added to `milling.ts` (the file already imports `unitTypeEnum` from `./price-list` and `cases` from `./case`, so this is a one-line addition, no cycle risk — `case.ts` doesn't import from `milling.ts`).

**Design decision — "service name" is category+subCategory, not freeform text.** The global client-facing `serviceCatalog` (`src/db/schema/price-list.ts`) already keys every service by `(category, subCategory, serviceType)`. Keeping `millingServiceCatalog` on the same two-part key (rather than a single freeform "service name" string) means a milling center's rate for "Crown & Bridge / Zirconia Crown" lines up exactly with the client-facing catalog row of the same name — required for the margin/cost-reporting use case already scoped in `milling-implementation-plan.md` (`partnerRate` vs `clientPrice`). The admin UI will still present this as a single "Service" column (concatenated `category — subCategory`, same rendering `PriceListTable.tsx` already does), with the category/subCategory chosen from a dropdown sourced from the existing `/api/admin/service-catalog` categories rather than typed freehand, so the keys always match.

### 1C. Migration — `src/db/migrations/0048_milling_center_onboarding.sql`

(Next available number — `0046_milling_schema.sql` and `0047_service_catalog_flows.sql` are the latest existing migrations, both already applied.)

Covers:

1. `ALTER TABLE milling_centers ADD COLUMN legal_name varchar(200)`, `owner_name/email/phone`, `finance_poc_name/email/phone`, `contract_doc_key text`, `contract_doc_name varchar(255)`, `contract_doc_uploaded_at timestamp`, `states_served text[]`, `avg_tat_days integer`, `enabled_service_types text[] not null default '{}'`.
2. `ALTER TABLE milling_service_catalog ADD COLUMN service_type service_type NOT NULL DEFAULT 'design_milling'` (temporary default so the `NOT NULL` backfill doesn't fail on the empty table — table has no rows in production since it's never been written to; drop the default after, or skip the default entirely since row count is 0), `ADD COLUMN monthly_capacity integer`.
3. `ALTER TABLE milling_service_catalog ADD CONSTRAINT milling_service_catalog_center_type_category_uniq UNIQUE (milling_center_id, service_type, category, sub_category)`.

No new Postgres enum needed — `service_type` enum already has all 3 values from migration `0047`.

---

## 2. Server library changes

- **`src/lib/milling/admin-guard.ts`** — no change, reuse `requireAdmin()` as-is for every new route below.
- **No zod** — confirmed zero usage of zod anywhere in `src/app/api/admin/**`, and it isn't even a dependency in `package.json`. New routes follow the existing manual-validation convention (`if (!x || typeof x !== 'string') return NextResponse.json({ error }, { status: 400 })`), same style as `centers/route.ts:32-39`.
- **`src/lib/milling/routing-engine.ts`** — currently has a comment (`line 48`) explicitly noting there's no capacity ceiling anywhere. Out of scope for this plan (routing logic isn't being touched), but flagged here since `monthlyCapacity` becomes available after this ships — a natural follow-up, not part of this admin-only plan.

---

## 3. File upload — Contract document (admin-only)

No generic single-document upload flow exists yet. The closest reusable template is the **independent bulk-upload route** (`src/app/api/cases/bulk/upload/route.ts`), which already demonstrates a collision-free staging-key pattern decoupled from case/lab semantics — better fit than the case-scan upload route (`src/app/api/cases/upload/route.ts`), which is hardwired to `labName`-based keys and `case_files` URL semantics.

**New file: `src/app/api/admin/milling/centers/[id]/contract/route.ts`**

Same 4-action shape (`?action=init|sign|complete|abort`) as the two existing upload routes, reusing the shared `r2`/`R2_BUCKET` client from `src/lib/r2.ts`:

- Guard: `requireAdmin()` from `src/lib/milling/admin-guard.ts` on every action (the user explicitly wants this admin-only) — the existing bulk/case upload routes don't need this since this is the first upload route scoped to a single role.
- `init`: query params `{ fileName, fileType, fileSize }` + `id` from the route param. Key: `milling-center-docs/<centerId>/<uuid>-<fileName>` (mirrors `bulk/upload/route.ts:82`'s `stagingOwnerPrefix` pattern, swapping uploader-id for center-id). Same `MAX_FILE_SIZE` (5GB is overkill for a contract PDF — cap at 25MB instead) and same `BLOCKED_EXTENSIONS` list.
- `sign`: body `{ key, uploadId, totalParts }` → `{ urls: [{partNumber, url}] }` — byte-identical to the existing implementation, copy as-is.
- `complete`: body `{ key, uploadId, fileName, parts }` → on success, **also** `UPDATE millingCenters SET contractDocKey = key, contractDocName = fileName, contractDocUploadedAt = now() WHERE id = centerId` (the one behavioral difference from the bulk-upload template, which doesn't persist to a DB row) → returns `{ success: true, contractDocKey, contractDocName }`.
- `abort`: identical `{ key, uploadId }` shape, no DB write.

**Download**: contract docs are admin-only and low-volume, so a simple `GET /api/admin/milling/centers/[id]/contract` that `requireAdmin()`s then returns a short-lived presigned `GetObjectCommand` URL (redirect or JSON `{ url }`) is enough — no need for the auth-proxy-download-URL pattern `case_files` uses for client-facing downloads.

**Why not a separate `millingCenterDocuments` table**: the user's spec is a single contract doc per center with a single admin-only upload button, not a document library. Three columns on `millingCenters` (`contractDocKey/Name/UploadedAt`) is sufficient and matches how `preferences/page.tsx` stores a single uploaded file inline on its own record (`src/lib/preference-forms.ts`) rather than in a side table. If multi-document support (W9, certifications, etc.) is wanted later, that's a clean additive migration — not blocking this plan.

**Client-side**: reuse `uploadFileInChunks`'s underlying XHR/part-upload mechanics but point at the new route — cleanest is a small new helper `uploadMillingCenterContract(file, centerId, onProgress)` in `src/lib/upload-utils.ts`, copy-adapted from `uploadBulkFile` (lines 199-325) since that's already generic (no `labName`/`clientId` coupling), just swapping the endpoint and the `centerId` param.

---

## 4. Admin API routes

| Route                                                                              | Methods                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/admin/milling/centers/route.ts`                                       | `POST`                                     | Extend accepted body to include all new step-1 fields (`legalName`, `ownerName/Email/Phone`, `financePocName/Email/Phone`) — same manual-validation style, only `name` stays required. `GET` unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/app/api/admin/milling/centers/[id]/route.ts`                                  | `PATCH`                                    | Extend accepted body to include step-1 fields above **plus** step-2 fields (`statesServed`, `avgTatDays`, `enabledServiceTypes`). `GET`/`DELETE` unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **New** `src/app/api/admin/milling/centers/[id]/contract/route.ts`                 | `POST` (`init/sign/complete/abort`), `GET` | Contract doc upload + presigned download, per §3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **New** `src/app/api/admin/milling/centers/[id]/service-catalog/route.ts`          | `GET`, `PUT`                               | Per-center service catalog, scoped by `?serviceType=design_only\|design_milling\|milling_only`. `GET` returns all rows for that center+flow (`includeInactive` implied — admin always needs to see disabled rows to re-enable them, unlike the client-facing catalog routes). `PUT` accepts `{ items: [{ id?, category, subCategory, unitType, partnerRate, monthlyCapacity, turnaroundDays, isActive, notes }] }` — upserts: rows with `id` update, rows without `id` insert (`onConflictDoUpdate` on the new unique constraint from §1B handles both cases in one query, same batch-save shape as `PUT /api/admin/service-catalog`). Auth: `requireAdmin()`. |
| **New** `src/app/api/admin/milling/centers/[id]/service-catalog/[itemId]/route.ts` | `DELETE`                                   | Remove a single service-catalog row (e.g. added by mistake) — batch `PUT` alone doesn't cleanly express row deletion, so a dedicated `DELETE` is simpler than diffing removed rows out of a batch payload.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

All five routes import `requireAdmin` from `src/lib/milling/admin-guard.ts`, matching the existing convention for every other `milling/*` admin route (not the ad-hoc local `requireAdmin()` pattern still used by `clients/*` — that's the older, since-superseded convention per the earlier codebase research).

---

## 5. Admin UI

### 5A. Step-1 / Step-2 onboarding wizard

Replace the current single-step `Dialog` in `src/app/admin/(dashboard)/milling/centers/page.tsx` with a two-step version, **inline component state**, following the exact pattern already used in `src/app/client/(dashboard)/preferences/page.tsx:54` (`useState<1|2>(1)`, conditional `{step === 1 && (...)}` blocks, Prev/Next buttons, "Step X of 2" header) — there's no stepper/wizard library in this codebase, and none should be introduced for a 2-step form.

**Step 1 — Company & Contacts**

- Company name (`name`, required)
- Company legal name (`legalName`)
- Contract doc — upload button, visible only when `editing` is set (a center must exist before a document can be attached to it, since the upload route is scoped to `[id]`) or immediately after step 1 is saved as a draft (see note below on draft-save ordering); admin-only per §3 — this button is simply never shown to non-admin roles, consistent with this whole page already being admin-only.
- Lab owner: name / email / phone
- POC: relabeled `contactName` / `email` / `phone` inputs (existing fields, just relabeled and regrouped in the form)
- Finance POC: name / email / phone
- City / HQ: existing `city` input, `state`/`country` inputs kept as they are today (already present in the current dialog, just moved under this step)
- Existing "Login password (optional)" input + `RefreshCw` random-password button stays in step 1, since it's tied to the POC email

**Step 2 — Coverage & Services**

- States served — a single text `Input` parsed via the existing `fromCsv`/`toCsv` helpers (copy the pattern from `RoutingRuleDialog.tsx:44-46`), placeholder `"CA, NY, TX or ALL"`.
- Avg TAT (days) — numeric `Input`.
- Services offered — 3 `Checkbox`/`Switch` toggles (Design / Design+Milling / Milling Only) writing to `enabledServiceTypes`.
- Service catalog — for each **checked** service type, a `Tabs` section (reusing `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from shadcn, same as `admin/(dashboard)/profile/page.tsx:236-253`) showing a small editable table: **Service | Unit | Price | Monthly Capacity | Enabled**. "Add service" row lets the admin pick category/subCategory from a dropdown (sourced from `GET /api/admin/service-catalog` distinct categories, per §1B's design decision) plus unit type, price, capacity. Unchecking a service type in the toggles above hides (but does not delete) its tab and its rows stay inactive server-side.

**Ordering / draft-save**: since the contract doc and the service catalog both need a real `centerId` to attach to, "Onboard Centre" changes from a single final submit to: **Step 1 "Next" already calls `POST /api/admin/milling/centers`** (creating the row with just the step-1 fields, exactly like today's `POST` already does), immediately unlocking the contract-doc upload button and moving to step 2 which then does incremental `PATCH`/service-catalog `PUT` calls against that new `id`. This mirrors how the existing single-step dialog already creates the center immediately on submit (`saveMutation`, `centers/page.tsx:40-56`) — this plan just splits that same create-then-refine flow across two screens instead of adding a "draft" concept. Editing an existing center (`openEdit`) opens directly into this same 2-step form pre-filled, landing on whichever step the admin last used (default step 1).

### 5B. Centers table

`src/app/admin/(dashboard)/milling/centers/page.tsx`'s existing table (Centre / Location / Active / Users / edit) gets two additional columns or a details-on-click affordance: **Services** (badges for enabled flows) and **Avg TAT**. Keep the row compact — states served and the full service catalog stay inside the edit dialog rather than inflating the table.

### 5C. New shared component (optional, recommended)

`src/components/MillingServiceCatalogTable.tsx` — extracted from the step-2 tab table markup described in §5A, parametrized by `centerId` + `serviceType`, so it's independently testable/reusable (e.g. if a future "view center" read-only detail page wants to render the same table without the edit affordances). Not strictly required for MVP — could stay inlined in the dialog — call this a nice-to-have, not a blocker.

---

## 6. Build order

| Order | Step                                                       | Why                                                        |
| ----- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | Schema + migration (§1)                                    | Everything downstream depends on the new columns existing  |
| 2     | Contract-doc upload route (§3)                             | Isolated, no dependency on the catalog work                |
| 3     | Center `POST`/`PATCH` field extension (§4, row 1-2)        | Needed before the step-1/step-2 form can save anything new |
| 4     | Service-catalog `GET`/`PUT`/`DELETE` routes (§4, rows 4-5) | Needed before step-2's catalog tabs can load/save          |
| 5     | Step-1/Step-2 wizard UI (§5A)                              | Wires up steps 3-4                                         |
| 6     | Centers table column additions (§5B)                       | Cosmetic, last                                             |

---

## 7. File list

### New files

- `src/db/migrations/0048_milling_center_onboarding.sql`
- `src/app/api/admin/milling/centers/[id]/contract/route.ts`
- `src/app/api/admin/milling/centers/[id]/service-catalog/route.ts`
- `src/app/api/admin/milling/centers/[id]/service-catalog/[itemId]/route.ts`
- `src/components/MillingServiceCatalogTable.tsx` (optional extraction, §5C)

### Modified files

| File                                                 | Change                                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/db/schema/milling.ts`                           | New columns on `millingCenters` and `millingServiceCatalog` per §1A/§1B; import `serviceTypeEnum` from `./case` |
| `src/app/api/admin/milling/centers/route.ts`         | `POST` accepts new step-1 fields                                                                                |
| `src/app/api/admin/milling/centers/[id]/route.ts`    | `PATCH` accepts new step-1 + step-2 fields                                                                      |
| `src/lib/upload-utils.ts`                            | New `uploadMillingCenterContract()` helper, adapted from `uploadBulkFile`                                       |
| `src/app/admin/(dashboard)/milling/centers/page.tsx` | Single-step dialog → 2-step wizard; table gains Services/Avg TAT columns                                        |

---

## 8. Open assumptions — confirm before implementing

1. **Contract doc is single-file, admin-only, replace-on-reupload** (no version history). If the user wants to keep old contract versions, that changes §3 from "3 columns" to a small `milling_center_documents` table.
2. **"Monthly capacity" is per-service** (on `millingServiceCatalog`, one cap per category/subCategory/serviceType row), not one aggregate cap per center. The user's spec lists capacity inside the per-service table, so this plan follows that — but worth confirming, since `milling-implementation-plan.md` also mentions an aggregate "capacity bar (current load / monthly capacity)" on the milling portal dashboard, which is a different, aggregate number. If both are wanted, an additional aggregate `monthlyCapacity` column would also go on `millingCenters` itself — not included here since it wasn't in the user's field list.
3. **States served governs routing/reporting only, not a hard submission gate** — this plan just stores the field; it doesn't wire it into `millingRoutingRules` matching logic (that's a separate, larger change to `src/lib/milling/routing-engine.ts` and out of scope for "admin level" onboarding).
4. **No zod introduced.** If the team wants to start adopting schema validation for this feature specifically (as a first foothold), that's a bigger call than this plan should make unilaterally — flagging it here rather than silently deviating from the existing manual-check convention.
