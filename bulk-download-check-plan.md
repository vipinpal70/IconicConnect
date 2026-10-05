# Bulk Download Tracking — Implementation Plan

**Goal:** record, per case, that it has already been fetched through the bulk-download feature, so the same lab (and the Iconic team) are not offered the same case again by mistake.

Builds on `bulk-download-plan.md` (the feature) and the activity-log entries it already writes (`case.bulk_download_started/completed/failed`).

---

## 1. Why a single `bulkDownloaded: true` field on `cases` is not enough

| Problem with one boolean / one `downloaded_at` | Consequence |
|---|---|
| The feature has **two different downloads**: lab downloads *outputs*; Iconic staff download the *lab's files* | One flag would mix them: a staff download would hide the case from the lab's download, or vice versa |
| Outputs change: after `client_feedback` a new `outputFile`/previews are uploaded | A permanent `true` would stop the lab from ever getting the corrected design |
| "Started" is not "done": cancel, network drop, server error | Must only be set when the ZIP was fully delivered |
| Two tabs/users start the same case at once | Needs a claim so both don't pass the check |
| Who/when/how much is needed for support questions ("I never got it") | A flag has no history |
| `activity_logs` already records events | It is an unindexed JSON log meant for the timeline, not a queryable state source (no index on `details->>'scope'`, 2 rows per case per download, retention unknown) |

So: **an event table is the source of truth, plus two cached timestamps on `cases`** for cheap list badges and filters.

---

## 2. Data model

### 2.1 New table `case_bulk_downloads` (source of truth)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `case_id` | uuid NOT NULL → `cases.id` **ON DELETE CASCADE** | |
| `client_id` | uuid NOT NULL → `profiles.id` | the lab that owns the case, copied from `cases.client_id` so lab-level queries need no join |
| `scope` | enum `bulk_download_scope` | `client_output` (lab downloads outputs) · `internal_files` (staff download lab files) |
| `status` | enum `bulk_download_status` | `in_progress` · `completed` · `failed` · `reset` |
| `downloaded_by` | uuid → `profiles.id` **ON DELETE SET NULL** | who triggered it (client or sub-user, or the staff member) |
| `downloaded_by_role` | text | kept even if the profile is later deleted |
| `files_delivered` | integer | files actually written into the ZIP |
| `bytes_delivered` | bigint | |
| `content_signature` | varchar(64) | SHA-256 of the sorted list of what was included (object keys + sizes). Used to detect "changed since" |
| `include` | jsonb | internal scope only: `{scan, reference, teethLibrary, outputs}` |
| `started_at` | timestamp NOT NULL default now | |
| `completed_at` | timestamp | set only when `status = completed` |

Indexes
- `(case_id, scope, completed_at DESC)` — latest completed download per case.
- `(client_id, scope, completed_at DESC)` — "everything this lab downloaded".
- **Partial unique index** `(case_id, scope) WHERE status = 'in_progress'` — the concurrency claim (section 4.2).

### 2.2 Two cached columns on `cases` (what you asked for)

| Column | Meaning |
|---|---|
| `client_output_downloaded_at timestamp NULL` | last time the **lab** completed a bulk download of this case's outputs. `NULL` = never |
| `internal_files_downloaded_at timestamp NULL` | last time **staff** completed a bulk download of the lab's files. `NULL` = never |

- No separate boolean: `downloaded = column IS NOT NULL`. One field cannot disagree with itself.
- These are a **cache of the event table**, written in the same transaction as the event. If they ever drift, a one-line backfill rebuilds them from `case_bulk_downloads`.
- Two columns (not one) because the two scopes are independent, and a lab must never see that staff downloaded its files (see 5.3).

### 2.3 Why not other designs
- *JSON on `cases`* — no index, cannot store history, awkward concurrent updates.
- *Per-user table (user × case)* — labs share cases across sub-users; the question is "has this **lab** got it", so tracking is per lab (`client_id`), with `downloaded_by` kept for audit.
- *Deriving from `activity_logs`* — see section 1.

---

## 3. Behaviour (rules)

1. **A case counts as downloaded only when the ZIP was fully delivered** (`status = completed`). Browser cancel, server error, or aborted stream → `failed`, the cached column is untouched, and the case stays downloadable.
2. **Files missing from storage** (e.g. removed by the 3-month R2 retention job) don't block completion: they are listed in `_SUMMARY.txt`; the case is `completed` if everything that *could* be fetched was.
3. **Default behaviour = skip already-downloaded cases, with an explicit override.** Not a hard block (decision D1): labs lose files, browsers fail to save, and the retention job deletes old objects, so a permanent block would strand people.
4. **"Changed since you downloaded it":** at preview time the server recomputes the content signature. If it differs from the last completed download (new output after feedback, new preview), the case is reported as `updated` and is **offered again** automatically.
5. **Admin can reset** a case's flag (logs a `reset` event, clears the cached column) for support cases.

Per-case state shown to the user: `never` · `downloaded` (date, by whom for staff) · `updated since download`.

---

## 4. Flow changes

### 4.1 Preview (`.../manifest`) — read only
For each requested case, load the latest `completed` event for that scope, compare signatures, and return:
```
download: { state: 'never' | 'downloaded' | 'updated', lastAt, lastBy? }
```
Cases in state `downloaded` are placed in `skipped` with reason *"Already downloaded on 5 Oct 2026"* unless the request has `includeDownloaded: true`.

### 4.2 Download (stream) — write
1. Re-run the same filtering as the preview (never trust the UI).
2. **Claim:** insert one `in_progress` row per case. The partial unique index rejects a second concurrent claim, and that case is skipped with *"Download already in progress"*.
3. Stream the ZIP (unchanged).
4. **On success:** in one transaction — set each row `completed` (`files_delivered`, `bytes_delivered`, `content_signature`, `completed_at`) and update `cases.<scope>_downloaded_at`.
5. **On failure/abort:** set rows `failed`; do not touch `cases`.
6. Existing activity-log entries stay as the audit trail and gain the new row id in `details`.

Stale claims (server crash leaves `in_progress`): the existing BullMQ cleanup scheduler marks `in_progress` rows older than 2 h as `failed`.

### 4.3 Case lists (client, ops, admin)
- `GET /api/cases` adds the cached column(s) to the list selection (no join, no extra query).
- **Client page:** "Downloaded" badge with date; filter chip *Not downloaded yet*; **Select all** selects only not-downloaded eligible rows; already-downloaded rows stay selectable (override) but show the date in the tooltip.
- **Ops/admin page:** same for `internal_files_downloaded_at`, plus who downloaded it.
- New dialog option: **"Include cases I already downloaded"** (off by default).

### 4.4 Admin reset
`POST /api/admin/cases/[id]/bulk-download/reset` (admin only): writes a `reset` event, nulls the cached column, logs `case.bulk_download_reset`.

---

## 5. Data integrity and safety

### 5.1 Case and client deletion
`ON DELETE CASCADE` handles single deletes, but this codebase deletes children **explicitly** in transactions (`src/app/api/cases/[id]/route.ts` DELETE, `src/lib/admin/delete-client.ts`). Add `case_bulk_downloads` to both lists so the "full cascade delete" keeps working and its confirmation counts stay accurate.

### 5.2 RLS / PostgREST
Migration 0056 locked the API roles out of the existing tables, but its loop only covered tables that existed then. The new migration must itself `ENABLE ROW LEVEL SECURITY` and `REVOKE ALL … FROM anon, authenticated` on `case_bulk_downloads`.

### 5.3 What each audience may see
- Clients receive only `client_output_downloaded_at`.
- Staff receive both, plus `downloaded_by` name.
- A lab must never learn that Iconic staff downloaded its files: strip `internal_files_downloaded_at` from every client-role response (list, detail, manifest). Enforce server-side, as with the timeline filter.

### 5.4 Not a security control
This is a convenience/duplication guard. Authorization (who may download which case) is unchanged and still enforced by the existing checks.

---

## 6. Implementation steps

1. **Schema** (`src/db/schema/case.ts` or new `bulk-download.ts`): enums, `caseBulkDownloads`, two columns on `cases`. Migration `0057_case_bulk_downloads.sql` + journal entry; includes RLS/REVOKE (5.2) and indexes. Run `npm run db:migrate` on staging first.
2. **Service layer** `src/lib/bulk-download/tracking.ts`: `getDownloadStates(caseIds, scope, signatures)`, `claimCases()`, `completeClaims()`, `failClaims()`, `resetCase()`, `computeSignature(entries)`.
3. **Wire into** `service.ts` (`buildManifest` + `streamDownload`) and the four routes (`includeDownloaded` param).
4. **List API:** add columns to `caseListSelection`; role-gate the fields (5.3).
5. **UI:** badge, filter chip, select-all rule, dialog override on client, ops and admin pages.
6. **Cleanup job:** expire stale `in_progress` rows (reuse the existing scheduler).
7. **Delete paths:** update case and client deletion (5.1).
8. **Admin reset** endpoint + button on the admin case page.
9. **Backfill:** none needed if the feature has not shipped to production; otherwise one script that creates `completed` events from existing `case.bulk_download_completed` activity rows.
10. **Tests:** signature stability, claim conflict, abort leaves flag unchanged, `updated` detection after a new output, client responses never contain the internal field, delete paths remove rows.

Estimated size: one migration, one new lib file, edits to ~10 existing files; no change to R2 or to the ZIP format.

---

## 7. Decisions needed

| # | Question | Recommended |
|---|---|---|
| D1 | Already-downloaded cases: **skip by default with override**, or block completely? | Skip by default + override |
| D2 | Track at lab level (all sub-users share) or per user? | Lab level, with `downloaded_by` for audit |
| D3 | Offer the case again automatically when its output changed? | Yes (signature check) |
| D4 | Who may reset a flag? | Admin only |
| D5 | Should staff see per-case "downloaded by Name" on the list? | Yes, staff only |
| D6 | Keep history forever or prune old events? | Keep (small rows); revisit after 12 months |


---

## 8. Implementation notes (as built)

Decisions confirmed: D1 skip by default + override · D2 lab level with `downloaded_by` · D3 re-offer on change · D4 admin-only reset · D5 staff see "by Name" · D6 keep history, revisit after 2 months.

Differences from the plan above:
- **Change detection uses per-file fingerprints, not one signature.** R2 keys are `labName/fileName`, so a corrected design re-uploaded under the same name keeps its key. Each fingerprint therefore includes the R2 ETag/last-modified. A case is `updated` only when it contains a fingerprint the last completed download did not; a *shrinking* set (e.g. a file removed by the 3-month retention job) is not an update. The table stores `fingerprints` (jsonb) plus the overall `content_signature`.
- **Stale claims expire opportunistically** (a claim older than 2 h is failed when the case is next claimed) instead of via a scheduler job: no new job, same result.
- **Reset UI lives in the download dialog** (admin only, per already-downloaded case) rather than on the case detail page. Reset voids earlier completed rows (`status = reset`), writes an audit row and clears the cached column(s).
- A case is marked downloaded only when every file for it was delivered; any file that fails to open leaves that case `failed` and re-downloadable.
- `case_bulk_downloads` is deleted explicitly in the case-delete and delete-client transactions as well as by `ON DELETE CASCADE`.

Where things are: `src/db/schema/bulk-download.ts`, migration `0057_case_bulk_downloads.sql`, `src/lib/bulk-download/{fingerprint,tracking}.ts`, reset route `api/admin/cases/[id]/bulk-download/reset`, staff-only field stripping in `src/lib/case-access.ts`.
