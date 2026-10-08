# Plan — Upgrade the live `master` database to the `phase2-designOnly` schema + data

Status: **script + migration implemented and rehearsed on a scratch Postgres. Nothing has been run on the live database.**
Updated for design-only Phase 7 (migration `0058_remove_milling.sql`) and the new `scripts/upgrade-master-to-design-only.ts`.

## 1. What was compared

`master` (live) vs `phase2-designOnly` (merge-base `6a06cdb`). Sources: `src/db/schema/*`, `src/db/migrations/*`, `meta/_journal.json`, `scripts/*`, `src/lib/price-list.ts`, `.github/workflows/deploy.yml`, `design-only-removal-plan.md`.

### 1.1 How migrations are applied
- `deploy.yml` triggers on **push to `phase2-designOnly`** and runs `npm run db:migrate` (`scripts/migrate.mjs` → drizzle `migrate()`) **before** `npm run build`. **Every push to this branch is therefore also a migration run** against whatever database the VPS `.env` points to.
- Drizzle runs only the journal entries (`meta/_journal.json`) newer than the last row in `drizzle.__drizzle_migrations`, **all in one transaction** — a failed migration leaves the DB unchanged.
- **Unjournaled files (important):** `0033_invoices`, `0034_invoice_payment_tracking`, `0035_model_billing` exist as files on both branches but are **not in the journal**, so `db:migrate` never runs them. Prod must already have them (the `invoices` table and the `unit_type` value `per_case`). The script's pre-flight checks for both and raises a red flag if missing. Likewise master has `0046_drop_service_catalog_service_type.sql` (unjournaled, probably never applied); this branch reuses number 0046 for `0046_milling_schema` — all migrations are idempotent (`IF NOT EXISTS`, guarded `DO $$`), so either prod state works.

### 1.2 Schema delta (master → designOnly), by migration
| Migration | Change | Effect on existing data |
|---|---|---|
| 0046_milling_schema | enum values, `cases.service_type`, `service_catalog.service_type`, unique → `(category, sub_category, service_type)`, **backfills a duplicate `design_milling` catalog row per item**, 4 `milling_*` tables, `profiles.milling_center_id` | catalog doubled — **removed again by 0058** |
| 0047_service_catalog_flows | `milling_only` value, `client_price_list.is_enabled`, `profiles.enabled_service_types` (sets every client to `{design_only,design_milling}`) | column dropped by 0058 |
| 0048_model_only_lab | `profiles.model_only_lab` | column dropped by 0058 |
| 0049 / 0054 | more milling columns/tables/enums | all dropped by 0058 |
| 0050_fix_appliances_typo | `Spot Guards` → `Sport Guards` | none |
| 0051 / 0053 / 0055 | new tables `case_preview_files`, `case_reference_files`, `case_hold_files` | new, empty |
| 0052_case_file_name_search_index | `CREATE EXTENSION pg_trgm` + GIN index on `case_files` | needs extension privilege; brief write lock on `case_files` during build |
| 0056_lock_down_postgrest_access | drops all RLS policies, revokes anon/authenticated grants | breaks anything reading data via the Supabase anon key / PostgREST (app uses Drizzle only — verify, §4) |
| 0057_case_bulk_downloads | `case_bulk_downloads` table + enums, 2 nullable timestamps on `cases` | none |
| **0058_remove_milling** | **guard** (aborts, changing nothing, if any case is non-Design / in a milling status, any milling user/centre exists, or an activity log was written by a milling user) → deletes non-Design catalog rows (client price rows cascade) → drops milling tables/enums, `profiles.{milling_center_id,enabled_service_types,model_only_lab}`, `cases.{service_type,design_source}`, `service_catalog.service_type` (unique key restored to `(category, sub_category)`) → recreates `case_status`, `user_type`, `user_role` without the milling values | **net schema ≈ master's schema + the new tables/columns above**; no doubled catalog survives |

Net effect of running 0046–0058 together on master data: `cases`, `invoices`, `profiles`, client prices and default prices are untouched; the temporary design_milling rows are created and deleted inside the same transaction.

### 1.3 What the data script still has to do
Because 0058 now cleans up after 0046/0047, the old "delete design_milling / reset enabled_service_types / normalise cases" data fixes are **no longer needed**. What remains:
1. **Complete the catalog** with the default items master doesn't seed (3D Model ×8, Implant Bars, …).
2. **Allocate** every active catalog item to every non-pending client's `client_price_list` (eager; the app also does this lazily via `getPriceListForClient`, so this is belt-and-braces + it applies the "Implant Bars copies the client's own Implants / Ti-Base price" rule).
3. (optional, `--apply-default-prices`) apply `scripts/price-list-seed.json` to the **default** catalog prices — off by default.
4. Clear the Redis `price-list:client:*` cache.
5. Verify (row counts vs the pre-flight snapshot, nothing missing, no duplicates).

## 2. Deliverable (implemented)

`scripts/upgrade-master-to-design-only.ts` — `npm run db:upgrade-to-design-only` (`tsx`). It does not replace `db:migrate`; it wraps it. It auto-detects which side of the migration it is on from the drizzle journal:

**Before `db:migrate` (migrations pending) — read-only pre-flight**
- Prints DB host/name, applied vs pending migrations, schema state.
- Red flags (resolve before migrating — 0058 would abort): milling users/centres, non-Design cases, cases in milling statuses, duplicate `(category, sub_category)` catalog pairs (the restored unique key would fail), missing `invoices` table / `per_case` enum value (unjournaled 0033/0035).
- Saves a row-count snapshot to `case_data/upgrade-snapshot-<ts>.json` (gitignored) for the post-check.
- `--apply` is refused while migrations are pending.

**After `db:migrate` — data fixes + verification**
- Dry run (default): runs the data fixes inside a transaction and **rolls back**, printing exactly what would be added.
- `--apply --confirm-db <dbname>`: same, committed. Refuses without the matching `--confirm-db` (wrong-database guard) and refuses while red flags exist.
- Then clears Redis (non-fatal) and prints the verification report. Idempotent — safe to re-run (second run adds 0 rows).

### Rehearsal results (scratch Postgres 16, replaying the repo's migrations + sample data)
- 0046–0058 run as **one transaction** on master-like data (clients with a custom `99.00` Crown price, a pending client, 3 cases): succeeded; milling tables gone; catalog back to 22 rows; custom price and case rows intact.
- 0058 guard: a leftover `design_milling` case/milling user/centre aborts the whole migration with nothing changed (verified earlier with leftover catalog rows, before they became a delete-step).
- Script: pre-flight, refusal while pending, refusal without `--confirm-db`, refusal on red flags, apply (10 catalog rows + 10 price rows added for the 1 active client, 0 for the pending client), verification ✓, second apply = 0 changes. `--apply-default-prices` dry run reports 15 default prices that differ from the JSON.
- Not rehearsed: Redis clear (no Redis in the scratch setup — the script skips gracefully), `pg_trgm` privilege on Supabase, real prod data volume.

## 3. Rollout

**Option 1 (recommended): rehearse, then migrate + fix data, then deploy.**
1. **Backup** the prod DB (`pg_dump` or Supabase backup). Write down the restore command; keep it until the soak period ends.
2. **Rehearse on a staging copy** (restore the backup into a scratch DB): `DATABASE_URL=<staging> npx tsx scripts/upgrade-master-to-design-only.ts` → `npm run db:migrate` → script dry-run → `--apply --confirm-db <name>` → run the app (`npm run build && npm start`) and click through.
3. **Prod, maintenance window**, from a `phase2-designOnly` checkout with prod `DATABASE_URL`:
   ```bash
   npx tsx scripts/upgrade-master-to-design-only.ts            # pre-flight, saves snapshot; must show no red flags
   npm run db:migrate                                          # 0046–0058 in one transaction
   npx tsx scripts/upgrade-master-to-design-only.ts            # dry run of data fixes
   npx tsx scripts/upgrade-master-to-design-only.ts --apply --confirm-db <dbname>
   ```
4. **Push/merge `phase2-designOnly`** → the workflow re-runs `db:migrate` (no-op) and builds/restarts.
   - Between steps 3 and 4 the old master code runs against the new schema. This is safe: the net schema is master's plus new tables/columns with defaults, and every enum value master uses still exists. Verify the 0056 risk first (§4).

**Option 2: just push** and run the data script right after. Now acceptable (migrations are atomic and leave no doubled catalog; the app lazily allocates price rows for new items), but a failed migration fails the deploy mid-way and you lose the pre-flight/backup discipline. Not recommended for prod.

**Rollback:** no down-migration. Restore the step-1 backup and redeploy `master`. (A failed migration run needs no restore — it is one transaction.)

## 4. Decisions / confirmations needed
1. **Which database does the VPS deploy use, and what is its migration state?** The branch's earlier pushes may already have run 0046–0057 there. The pre-flight prints applied vs pending migrations; run it first.
2. **Prod pre-flight output:** run it yourself (or allow me to) and check for red flags — especially `invoices` / `per_case` (unjournaled migrations).
3. **Default prices:** leave current defaults (assumed) or pass `--apply-default-prices`.
4. **0056 risk:** confirm master code/clients don't read data with the Supabase anon key / PostgREST (`grep -rn "supabase.from(" src` on master) before migrating.
5. **`pg_trgm`:** confirm the DB role may `CREATE EXTENSION pg_trgm` (migration 0052), or enable it in the Supabase dashboard beforehand.
6. Any milling/partner test data on prod? If yes, 0058 aborts. The old conversion script (export CSVs + delete milling data) is no longer in the repo because it imports the removed milling schema — restore it from commit `0e68177` and run it against a pre-0058 schema (`git show 0e68177:scripts/convert-to-design-only.ts`).

## 5. Out of scope
- Application code changes beyond what is already on the branch.
- Preference-form backfill: separate script `scripts/backfill-default-preference-forms.ts` (from master) if existing clients need a default form.

## 6. Files
- `src/db/migrations/0058_remove_milling.sql` (+ journal entry)
- `scripts/upgrade-master-to-design-only.ts`, npm script `db:upgrade-to-design-only`
- `src/lib/default-catalog.ts` (default catalog rows, shared by the app seed and this script)

## 7. Read-only inspection of the database in `.env` (2026-10-08)

Host `aws-1-ap-southeast-2.pooler.supabase.com`, db `postgres`, 30 MB. Read through a `READ ONLY` transaction — nothing written.

- **Migration state:** drizzle table has 4 rows, last `created_at` = 1785149369977 (= the journal timestamp of `0046_milling_schema`); **pending: 0047 … 0058**.
- **Shape is neither pure master nor pure phase2:** `cases.service_type`, `profiles.milling_center_id`, the 4 `milling_*` tables (all empty), enums `service_type(design_only, design_milling)`, `case_status`/`user_role`/`user_type` with milling values — **but** `service_catalog` has **no** `service_type` column (master's unjournaled `0046_drop_service_catalog_service_type` was applied; unique key is `(category, sub_category)`). Original `0058` assumed that column existed and would have aborted; it now checks `information_schema` first.
- **Data (nothing milling-related):** 903 cases (all `design_only`; none in a milling status), 32 profiles (2 admin, 4 designer, 3 qc, 21 client, 2 subuser — no milling users, no `milling_center_id`), 0 milling-authored activity logs, 0 milling centres/assignments/rules/catalog. 7,070 activity logs, 903 case files, 224 chat messages, 12,587 notifications, 21 preference forms, 1 support ticket, 0 invoices.
- **Pricing:** `service_catalog` 23 rows, no duplicates; `client_price_list` 483 rows = 21 clients × 23, none orphaned; every client has a row for every catalog item.
- **Integrity:** no orphan cases/files/notifications/logs; no views, triggers or public functions (nothing blocks enum retyping); RLS enabled on 21 tables with 0 policies; 200 anon/authenticated grants (removed by 0056; the only client-side PostgREST read in master is the user's own `profiles` row, which 0056 keeps).
- **Extensions:** `pg_trgm` not installed but available; role is not superuser but has `CREATE` on the database (pg_trgm is a trusted extension) — 0052 should work.
- **Legacy values not touched by the upgrade:** `cases.category` holds old spellings (`Crown & Bridges`, `Implant`, `Denture`) — pre-existing, unrelated to this migration.

### Rehearsal on a replica of this shape
Scratch Postgres rebuilt to match (0046 applied, catalog without `service_type`, 21 clients × 23 price rows, 120 cases with the legacy categories, a custom client price): `0047 … 0058` in **one transaction** → no errors; cases/profiles/price rows/catalog unchanged (120/30/483/23); custom price kept; milling tables gone; `Spot Guards` → `Sport Guards`. Then the script `--apply`: +9 catalog rows (3D Model ×8, Implant Bars) and +189 client price rows (= 21 clients × 9); verification passed; second run added 0.
