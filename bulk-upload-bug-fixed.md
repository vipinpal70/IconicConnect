# Bulk Upload & File Storage — Bug Fixes

**Branch:** `no-supabase-rewrite` · **Status:** implemented, not committed · **Date:** 2026-11-12

This covers the bulk design-output upload fixes and the file-storage safety work that came out of it: what was wrong, what changed, the decisions behind it, how existing data is handled, and what is still open.

---

## 1. Summary

The bulk upload matched output files to cases unreliably and showed every in-progress case in the system to every designer and QC. Investigating it uncovered a more serious storage bug: **a design output named like the lab's scan overwrote the lab's original scan file**, and more generally **any two files with the same name in the same lab could overwrite each other**.

What is fixed:

| Area | Before | After |
|---|---|---|
| Output overwriting the lab's scan | Output written to `<lab>/<name>`, the same key as the scan | Outputs/previews go to case- and upload-scoped folders |
| Same-name files in a lab (scans, chat, reference…) | Shared `<lab>/<name>` key, so the last upload won | Every new upload gets its own `uploads/<id>/` folder |
| "Remove file" before creating a case | Deleted `<lab>/<name>`, possibly another case's scan | Deletes the exact uploaded file; server refuses to delete anything still in use |
| Which cases bulk upload shows | Every `in_progress` case, all labs, to anyone | Only the user's own assigned in-progress cases (admins: all) |
| Who can attach an output (server) | Any designer/QC to any case | Re-checked per item: assignment + status + name |
| Name matching | Exact name of the *first* scan file only | All scan files + case number, tolerant of separators, `(1)`, `_final`… |
| Matching timing | After the whole batch finished uploading | Immediately on drop, before uploading |
| Adding more files | Reset cases the user had picked by hand | Earlier rows are never touched |
| Failed confirm | Staged file already deleted, so no retry possible | Staged file kept until the case update commits |
| Staged bulk uploads expiry | 2 hours | 6 hours |

---

## 2. Root causes found

1. **Shared storage keys.** Every upload (lab scans, outputs, previews, chat, reference images, teeth library) was stored at `<labName>/<fileName>`. The output-matching rule *requires* the output to be named after the scan, so with the same extension (`Smith_J.zip` → `Smith_J.zip`) the output replaced the scan object. Both DB rows then pointed at the design. Migration `20261010001700_files_key_per_owner.sql` confirms real data already has objects shared between a scan and an output.
2. **Unsafe delete endpoint.** `DELETE /api/cases/files` deleted any `<lab>/<name>` object without checking whether a case referenced it.
3. **No scoping.** `/api/cases/bulk/match` returned all `in_progress` cases (with lab names and file names) to any designer/QC/admin; `/api/cases/bulk/confirm` checked role only, not assignment.
4. **Narrow matching.** Only the earliest scan file was used as the key; any suffix, separator change or double extension failed; case numbers were never used; a manually picked case skipped the name rule entirely.
5. **UI flow bugs.** Matching waited for multi-GB uploads; re-matching overwrote manual choices; the badge didn't update after a manual pick; duplicates were only caught on Send.
6. **Ordering bug in confirm.** The staged object was deleted *before* the DB transaction, so a failed item could not be retried.

---

## 3. What changed

### 3.1 Storage keys (new uploads only)

| Upload type | New R2 key |
|---|---|
| Lab scans, reference images, chat attachments, teeth library, 3Shape ZIPs (general upload route) | `<lab>/uploads/<uploadId>/<original name>` |
| Design output (bulk + single-case) | `<lab>/case-outputs/<caseId>/<uploadId>/<original name>` |
| Design preview (bulk + single-case + "Replace") | `<lab>/case-previews/<caseId>/<uploadId>/<original name>` |
| Hold images | unchanged (already `hold-images/<caseId>/<uuid>-<name>`) |
| Bulk staging | unchanged (`bulk-staging/<userId>/<uuid>-<name>`) |

- The **last path segment is always the original file name**, so downloads keep it (`Smith_J.zip`).
- The upload route still returns the **plain name** in `fileName`, so case files, chat, duplicate-case detection and name matching behave exactly as before. The full storage name is returned separately as `storageName`.
- Plain-name uploads get their folder **chosen by the server**. Clients cannot request `uploads/…` themselves, and only staff may request `case-outputs/…` or `case-previews/…`.

### 3.2 Bulk upload — server

- **Eligibility** (`src/lib/bulk-output-eligibility.ts`), shared by match and confirm:
  - designer → `in_progress` cases where they are the assigned designer
  - QC → `in_progress` cases where they are the assigned QC
  - admin → all `in_progress` cases
- **Matching** (`src/lib/bulk-output-matching.ts`), shared by the server and the UI. Tiers:
  - `exact` — same name as any scan file, ignoring extension and case (the old rule)
  - `normalized` — equal after removing separators, `(1)`, `copy`, `final`, `design`, `output`, `v2`…, stacked extensions (`.stl.zip`)
  - `case-number` — file named after the case number (minimum 4 characters)
  - `similar` — typo-level difference; **only a suggestion**, never auto-assigned
- **Confirm** (`/api/cases/bulk/confirm`), per item:
  - re-checks assignment, status and name
  - a name weaker than an auto-match requires `nameOverride: true`, recorded in the activity log (`nameOverride`, `nameMatch`, `scanFileNames`)
  - copies to case-scoped keys, then one transaction (status update guarded by `status = 'in_progress'`, output row, note, preview rows)
  - deletes the staged upload only after commit; on failure removes the copies and keeps the staged file for retry
  - rejects a batch that assigns two files to the same case
- **Match** returns `scanFileNames` (array) instead of `scanFileName`, and the statuses `matched | ambiguous | suggested | unmatched`. Duplicate detection moved to the UI, which sees the whole batch.

### 3.3 Bulk upload — UI (`src/components/BulkOutputUploadModal.tsx`)

- Files are matched **by name the moment they are dropped**; nothing uploads yet.
- `matched` and `ambiguous` files start uploading straight away. `suggested` and `unmatched` files upload only after a case is picked.
- Adding more files never changes earlier rows.
- **Searchable case picker** (case number, lab, scan name), with best matches first.
- Per-row flags: *Duplicate case*, *Name mismatch* (with a "Use anyway" tick), *Upload failed* (with Retry).
- Send stays disabled until every row has a case, no duplicates, confirmed overrides and finished uploads.
- Escape inside the case search closes only the search, not the dialog (closing the dialog discards the batch).

### 3.4 Single-case design upload (ops cases page)

- Output and previews use case-scoped storage names.
- The name check uses the same shared rules: it accepts `exact`, `normalized` and `case-number` against **all** scan files. Close names and typos are still blocked (there is no "use anyway" here).
- The dialog lists all scan names it can match.

### 3.5 Other code touched

| File | Change |
|---|---|
| `src/app/api/cases/upload/route.ts` | Server picks `uploads/<id>/` for plain names; returns plain `fileName` + `storageName`; staff-only case-output/preview folders |
| `src/app/api/cases/files/route.ts` | Downloads named by the last path segment; DELETE refuses keys referenced in `files` (409) |
| `src/app/api/cases/xml-extract/route.ts` | 3Shape import resolves the key from `fileUrl` (lab-pinned); falls back to `<lab>/<name>` for older clients |
| `src/app/api/cases/bulk/upload/route.ts` | Staging names must be plain (no `/`) |
| `src/lib/security/file-name.ts` | Allows the exact `case-outputs/<uuid>/<uuid>/<name>` and `case-previews/…` shapes |
| `src/lib/case-file-keys.ts` | New: storage-name helpers (`caseScopedStorageName`, `uploadStorageName`, `displayFileName`, `withCaseScopedName`) |
| `src/lib/bulk-download/names.ts` | URL fallback uses the last path segment |
| `src/lib/queue/r2-cleanup-task.ts` | Grace period default 2h → **6h**; writer list documents the new key layout |
| `.env.example` | `R2_CLEANUP_GRACE_HOURS=6` |
| Ops / client cases pages, `AddCaseDialog.tsx` | "Remove file" deletes by the file's exact URL |
| `CaseDetailView.tsx` | Preview "Replace" uses a case-scoped name |
| `scripts/audit-output-scan-collisions.ts` | New read-only audit (see §5) |

---

## 4. Decisions taken

| Decision | Reason |
|---|---|
| Bulk eligibility stays **`in_progress` only**, for QC too | Explicit requirement. QC's `internal_qc` uploads stay in the single-case flow. |
| Per-upload folders (`<uploadId>`), not just per-case | A failed re-upload for the same case can never clobber the output that is still live. |
| Original name kept as the last key segment | Labs download the file under its real name; no display-name column needed. |
| Server chooses the storage folder for general uploads | Fixes every upload screen at once, without editing each caller. |
| Callers still receive the plain `fileName` | Case files, chat, duplicate detection and matching depend on it; zero behaviour change for them. |
| **No migration of existing files** | Moving objects or rewriting URLs risks the very data loss being fixed. Old keys are now read-only from the app's point of view, since nothing writes a flat key any more. |
| Delete endpoint refuses referenced keys | Fixes the existing data-loss risk regardless of what any client sends. |
| `similar` matches are suggestions only | A wrong auto-assignment sends the wrong design to a lab. |
| Name override allowed in bulk, recorded in the activity log | Real files are sometimes named inconsistently; the override is explicit and auditable. |
| Grace period raised globally to 6h | It only delays deletion of *unreferenced* objects, so it can only be safer. It also matches the 6h presigned upload-URL lifetime. |
| Duplicate-case detection in the UI, plus a server guard per batch | The UI sees the whole batch across several drops; the server still rejects two items for one case. |

---

## 5. Existing data — how it is handled

- **Nothing is moved or rewritten.** Existing scans, previews, outputs, reference images, hold images, chat attachments and teeth-library files keep their current `<lab>/<name>` keys and URLs, and are served exactly as before.
- **Old files can no longer be overwritten**, because every write path now produces a unique key:
  - the general upload route
  - bulk confirm
  - the server-side `putLabFile` fallbacks (already `<caseNumber>/…`)
  - hold images
  - bulk staging
- **Old files can no longer be deleted by the "remove file" button** while any record references them.
- Cleanup, retention, case deletion and client deletion all work from `files.r2_key`, so old and new keys are handled the same way.

**Damage that may already exist** (before this fix) cannot be undone automatically: a scan overwritten by a same-named output, or by another case's same-named upload. To find it:

```
npx tsx scripts/audit-output-scan-collisions.ts          # summary + table
npx tsx scripts/audit-output-scan-collisions.ts --csv    # full list
```

The script only reads. Rows with `scan_overwritten = true` need restoring from a backup taken before the other file's `created_at`.

---

## 6. Behaviour changes users will notice

- **Designers and QC see only their own cases** in bulk upload. A QC on a case with no QC set must use "Assign QC to Self" first.
- **Matching is looser:** `Smith_J_final (1).zip` now matches `Smith_J.zip`, in both bulk and single-case upload.
- **Mismatched names in bulk** need an explicit "Use anyway" tick, shown per row.
- **Unmatched files** don't upload until a case is chosen.
- **Removing a file** that a case already uses now does nothing (the server answers 409); previously it could delete that case's file.

---

## 7. Things to know / risks

- **Staging still has a time limit.** Staged bulk files are reaped after 6h if not confirmed; confirming then fails and the file must be re-added. Configurable via `R2_CLEANUP_GRACE_HOURS` (not set in `.env`; check the server's environment).
- **Closing the dialog discards the batch.** Closing the bulk dialog while nothing is uploading still deletes everything staged (unchanged behaviour).
- **Secure context required.** `crypto.randomUUID()` (case-scoped names in the browser) needs HTTPS or `localhost`. Hold images already rely on this.
- **Storage usage grows a little.** Re-uploading the same file no longer reuses one object. Old objects become unreferenced and are reclaimed by the orphan sweep.
- **Merge note:** `stash@{0}` (3D viewer work on `feat/3d-scan-visualization`) also adds `import { files }` to `src/app/api/cases/files/route.ts`, so expect a one-line conflict; keep both imports. The 3D preview code already reads file names from nested keys correctly.
- **Activity log detail fields** (`nameMatch`, `nameOverride`, `scanFileNames`) are staff-only; labs only see the timeline label.

---

## 8. Verification

**Done**
- `tsc --noEmit` clean.
- Production `next build` succeeds.
- 103 tests pass, including new suites:
  - `bulk-output-matching.test.ts` — name keys, tiers, ambiguity, suggestions, override rule
  - `bulk-output-safety.test.ts` — eligibility, case-scoped and upload-scoped names, validator shapes
  - additions to `security.test.ts` and `bulk-download/__tests__/names.test.ts`
- Impact review of every reader/writer of storage keys and file URLs: download route, bulk download, cleanup, retention, case/client deletion, 3Shape import, case creation, preview files, single-case upload, lists, timeline.
- Lint: no new errors (remaining errors are pre-existing `any` types).

**Not yet verified**
- Manual run in a browser with real cases and files.
- `audit-output-scan-collisions.ts` against the real database (not run, because `.env` may point at production).

**Suggested manual test**
1. As a designer, bulk-drop four files: exact name, `<scan>_final (1).zip`, a shared name like `scan.zip` across two of your cases, and an unrelated file. Check the badges, the deferred upload and the picker.
2. Assign the unrelated file by hand → "Use anyway" appears → Send works and the activity log shows `nameOverride`.
3. Assign two files to one case → *Duplicate case*, Send disabled.
4. As a lab, create a case with `scan.zip`, remove it before submitting, upload again, submit. An older case's `scan.zip` must still download.
5. Download the output as the lab: the file name must be the original.
6. 3Shape import of a ZIP: extraction still works.

---

## 9. Open questions

1. **Should QC be able to bulk-upload for `internal_qc` cases** (upload + approve to client in one step), matching what the single-case flow allows?
2. **Should single-case upload get a "Use anyway" override** like bulk, or stay strict?
3. **When will the audit script run against production**, and who owns restoring any overwritten scans from backup?
4. **Should closing the bulk dialog keep staged files** (e.g. a "discard all?" confirm) instead of deleting them silently?
5. **Related, separate issue:** the case API returns `outputFile` to labs before the design is released (the UI hides it, the API doesn't). Should the server withhold it until `submitted_to_client` or later?

---

## 10. Rollback notes

- **No database migration**, so code can be reverted safely.
- **Files uploaded after deploy** live under `uploads/`, `case-outputs/` and `case-previews/`, with URLs that encode the full path. The download route, cleanup and bulk download read them generically, so they keep working even after reverting the upload logic. **Do not revert `src/app/api/cases/files/route.ts` and `src/lib/bulk-download/names.ts`** without keeping their last-segment naming, or downloads of new files will be named `case-outputs_…`.
