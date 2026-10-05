# Bulk Download — Implementation Plan

**Goal**

- **Client / subuser:** select cases and download all **Case-Output files** (uploaded by designer / QC / admin) in one go.
- **Internal team (admin, QC, designer, account manager):** select cases and download all **case files uploaded by the client/lab**.

Both are delivered as a single ZIP, one folder per case.

---

## 1. What exists today (findings)

### 1.1 Case file data model — `src/db/schema/case.ts`

| Table / column                                       | Holds                                                                                                                                                                             | Written by                                                     | Storage                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `cases.outputFile` (text)                            | The **one** final design/output file (URL)                                                                                                                                        | designer/QC/admin (single upload in ops page, or bulk confirm) | R2 (proxy URL); legacy/milling-partner rows use Supabase public URL                  |
| `cases.outputNote`                                   | Note attached to the output                                                                                                                                                       | same                                                           | –                                                                                    |
| `case_preview_files`                                 | Up to 5 design previews per case (deliverables)                                                                                                                                   | designer/QC/admin                                              | R2 proxy URL                                                                         |
| `case_files`                                         | Client **input scans** (first row = original scan, used for bulk-match). Also receives designer "note" attachments and milling production photos via `POST /api/cases/[id]/files` | client/subuser/admin on create; others later                   | R2 proxy URL (create flow) / Supabase (`/api/cases/[id]/files`, milling files route) |
| `case_reference_files`                               | Reference images added at case creation (max 5)                                                                                                                                   | client / lab                                                   | R2                                                                                   |
| `case_hold_files`                                    | Hold-reason images (max 5)                                                                                                                                                        | admin/QC/designer                                              | R2                                                                                   |
| `cases.teethLibraryFileUrl` / `teethLibraryFileName` | Optional custom teeth library from client                                                                                                                                         | client                                                         | R2                                                                                   |

Every file table has `fileName`, `fileUrl`, `fileType`, `fileSize (bigint)`, `uploadedBy → profiles.id`, `createdAt`, and is indexed on `caseId`. Only `cases.outputFile` has **no size/name column** (name must be parsed from the URL).

### 1.2 How files sit in R2

- One bucket (`R2_BUCKET`), S3 client in `src/lib/r2.ts`.
- **Key = `${labName}/${fileName}`** (`labName` from `getProfileLabName(clientProfile)`: labName → fullName → email → "Client"). No case id in the key.
- DB stores a **proxy URL**, not the key: `/api/cases/files?labName=…&fileName=…`. `keyFromProxyUrl()` in `src/lib/r2-objects.ts` reverses it to the key (returns `null` for Supabase/legacy URLs).
- `GET /api/cases/files` is the auth gate: internal roles (admin_portal, qc, designer, account_manager) can read anything; client/subuser only when `labName` matches their (parent's) lab. It streams the R2 body (`transformToWebStream`) — never buffers.
- Uploads are browser-direct multipart to R2 via presigned part URLs (`/api/cases/upload`, `init → sign → complete`, 5 GB cap).
- Housekeeping that affects us: `r2-cleanup-task` (orphan sweep) and `r2-retention-task` (**deletes every object ≥ 3 months old** while leaving DB rows) → old cases will have dead links, so the zip builder must tolerate missing objects.
- Known quirk: because the key ignores case id, two cases from the same lab with the same file name share one object. Not in scope to fix, but the zip must de-duplicate names _within_ a case folder.

### 1.3 Bulk upload (designer / QC / admin design output)

`BulkOutputUploadModal.tsx` on the ops cases page, three routes under `src/app/api/cases/bulk/`:

1. **`upload`** — same multipart protocol as the normal upload but stages objects at `bulk-staging/<uploaderId>/<uuid>-<fileName>`. Roles: designer/qc/admin.
2. **`match`** — takes uploaded file names, loads all `in_progress` cases, matches by **original scan file stem** (first `case_files` row, extension stripped, case-insensitive). Returns `matched | unmatched | ambiguous | duplicate` + eligible cases.
3. **`confirm`** — per item, independently (one failure never rolls back others): re-checks `status === 'in_progress'`, `CopyObject` staging → `labName/fileName` then `DeleteObject` staging, sets `cases.outputFile`/`outputNote`, inserts optional `case_preview_files` (≤5, ≤1 GB), transitions status (**designer → `internal_qc`**, **qc/admin → `submitted_to_client`** and stamps `submittedToClientAt`), logs activity, notifies client/QC, invalidates Redis caches.

### 1.4 Bulk approve

There is **no server-side bulk-approve endpoint**. It is a UI selection mode in `src/app/(ops)/cases/page.tsx` (~L1000–1075):

- `approveSelectMode` + `selectedApproveIds` (Set), `approvableCases` derived from the filtered list (status `internal_qc`; admin = any, QC = assigned and not also designer), select-all-approvable, exit-mode helper.
- Confirm fires **one `PUT /api/cases/[id]` `{status:'submitted_to_client'}` per selected case** via `Promise.allSettled`, toasts ok/failed counts, refetches.
- Client-side "approve" (`submitted_to_client → approved`) is per-case only and has no selection UI; the client cases table (`src/app/client/(dashboard)/cases/page.tsx`, table ~L2018) has no checkboxes today.

**Takeaway for this feature:** reuse the ops page's _selection-mode_ UX pattern, but the download itself must be a **server-built ZIP**, not N parallel client calls (browsers throttle/block multiple downloads, and files can be multi-GB).

### 1.5 Constraints that shape the design

- Web app is a single PM2 process, `max_memory_restart: '2G'` → **must stream**, never buffer files.
- nginx (`nginx/connect.fynback.com`): `proxy_buffering off`, `proxy_read_timeout 600s` → streaming responses work; timeout applies to gaps between bytes, not total time.
- No ZIP _writer_ dependency (only a minimal _reader_ in `src/lib/three-shape/zip.ts`). BullMQ + Redis already exist (worker process, 500 MB cap).
- Next.js is v16 with breaking changes (`AGENTS.md`): **read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before writing the route handlers** (streaming `Response`, `maxDuration`, runtime = nodejs).

---

## 2. Design

### 2.1 What goes into each ZIP

**Client / subuser download → "Case Output":**

```
IconicConnect-outputs-<yyyymmdd-hhmm>.zip
└── <caseNumber>/
    ├── <outputFile name>            (cases.outputFile)
    ├── preview/<preview files>      (case_preview_files — see decision D2)
    └── output-note.txt              (cases.outputNote, only if present)
```

**Internal download → "Client / Lab Files":**

```
└── <caseNumber>/
    ├── scan/<case_files …>          (input scans)
    ├── reference/<case_reference_files …>
    └── teeth-library/<teethLibraryFileName>
```

Optional toggle (D3): also include `output/` for internal users.

Both: a root `_SUMMARY.txt` listing included cases/files and anything **skipped** (missing in R2, no files, not permitted, legacy URL failed).

### 2.2 Delivery mechanism — streamed ZIP over one HTTP response

- Route builds the archive **on the fly** and returns `new Response(readableStream)` with `Content-Type: application/zip`, `Content-Disposition: attachment`, `X-Accel-Buffering: no`. No temp files, no full buffering.
- Entries added **sequentially**; each R2 `GetObject` body piped in (`transformToWebStream` / Node stream) → backpressure keeps memory flat.
- Compression: **store (level 0)** — CAD/scan formats (STL/PLY/zip/dcm) are already compressed; saves CPU.
- ZIP64 required (multi-GB total). Use **`archiver`** (or `zip-stream`/`fflate` — pick during spike, must support ZIP64 + streaming). New dependency; add to `package.json`, mark as server-external if bundling complains (like `ioredis` in `next.config.js`).
- Abort handling: listen to `req.signal` → `archive.abort()` and destroy in-flight R2 streams.
- Trigger from the browser with a **hidden `<form method="POST" target="_blank">`** carrying `caseIds[]`. Cookie auth works, the browser handles the download natively with a real progress bar, no JS memory use. (Fallback if we later need a token: POST → short-lived Redis token → GET link.)

### 2.3 Two-step API (preflight + download)

Following the "one API route per UI section" preference, and splitting by role/audience rather than one monolith:

| Route                                      | Method                    | Purpose                                                                            |
| ------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------- |
| `/api/client/cases/bulk-download/manifest` | POST `{caseIds}`          | Preflight for the client dialog: per-case file count, total bytes, skipped reasons |
| `/api/client/cases/bulk-download`          | POST (form)               | Streams the client output ZIP                                                      |
| `/api/cases/bulk/download/manifest`        | POST `{caseIds, include}` | Preflight for internal dialog                                                      |
| `/api/cases/bulk/download`                 | POST (form)               | Streams the internal ZIP                                                           |

Shared server code in **`src/lib/bulk-download/`**:

- `access.ts` — `loadDownloadableCases(profile, caseIds)`: ownership/role filtering (below).
- `collect.ts` — `collectClientOutputEntries(cases)` / `collectInternalEntries(cases, include)` → `Array<{ caseNumber, zipPath, source: {kind:'r2', key} | {kind:'http', url}, size?: number }>`. One batched query per table with `inArray(caseId, ids)` (no N+1).
- `resolve-source.ts` — proxy URL → R2 key via existing `keyFromProxyUrl`; Supabase/other absolute URL → `http` source; anything else → skipped.
- `zip-stream.ts` — builds the streaming archive, de-dupes names per folder (`name (2).ext`), sanitises path segments (strip `..`, `/`, control chars, reserved chars), records `_SUMMARY.txt`.
- `limits.ts` — constants (below).

### 2.4 Authorization (server-enforced, never trust the UI)

- **Client/subuser:** `effectiveClientId = role==='subuser' ? profile.createdBy ?? profile.id : profile.id`; every requested case must have `cases.clientId === effectiveClientId`, otherwise dropped and reported (not a hard 403 for the whole batch).
- **Client output visibility:** only cases whose status is one where the UI already exposes deliverables. `CaseDetailView` gates on `submitted_to_client | approved | delivered`; the plan is a shared constant `CLIENT_OUTPUT_VISIBLE_STATUSES` (`submitted_to_client`, `approved` per D4) used by both the detail view and this route so they can't drift. Note this is narrower than today's detail-view gate (which also shows `delivered`); decide whether to align the detail view or leave it.
- **Internal:** roles `admin | qc | designer | account_manager` (same allow-list as `/api/cases/files`). Milling portal roles excluded. Whether designers/QC are limited to _assigned_ cases is decision D1.
- Milling-only / design-partner cases: client must not see milling terminology or centre-side files — only include files from the tables above and skip anything uploaded by `milling_*` roles.
- Uploader filtering for internal "client/lab" files: `case_files` mixes client scans with designer note-attachments and milling production photos. Filter with `JOIN profiles ON uploadedBy` and **exclude `designer`, `qc`, `milling_*` uploaders** (keep `client`, `subuser`, `admin` — D5).

### 2.5 Limits & failure behaviour

| Limit                              | Default                               | Notes                                                                             |
| ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Cases per request                  | 20                                    | reject above; UI disables button                                                  |
| Total bytes per zip                | 10 GB (env `BULK_DOWNLOAD_MAX_BYTES`) | computed from `fileSize` columns; `outputFile` sized via `HeadObject` in manifest |
| Concurrent bulk downloads per user | 1–2                                   | Redis counter with TTL; protects the 2 GB process                                 |
| Per-file R2 error                  | skip + log in `_SUMMARY.txt`          | `NoSuchKey` is expected after 3-month retention                                   |

If a file fails **mid-stream** after headers are sent, the zip cannot return an HTTP error — skip that entry, list it in `_SUMMARY.txt` (written last), and continue. Pre-validation in the manifest step (HEAD checks) is what surfaces most problems before the user starts.

Audit: one `logActivity` per case, `action: 'case.bulk_downloaded'` (add to the activity action union), details `{ files: n, by: role }`. Fire-and-forget like other routes.

---

## 3. Frontend

### 3.1 Shared pieces (`src/components/bulk-download/`)

- `useBulkSelection()` hook — `Set<string>` of ids, `toggle`, `toggleAll(visibleIds)`, `clear`, cap enforcement, `isSelectMode`. Modeled on `approveSelectMode/selectedApproveIds` in the ops page (extract rather than copy-paste a third time).
- `BulkDownloadBar` — sticky bar: "N selected · Download", clear button.
- `BulkDownloadDialog` — calls the manifest route, shows per-case counts, total size, skipped reasons; on confirm submits the hidden form. For internal users, checkboxes for `Scan files / Reference images / Teeth library / (Outputs)`.

### 3.2 Pages

- **Client** `src/app/client/(dashboard)/cases/page.tsx`: add checkbox column + "Select cases" toggle. Only rows with downloadable output are selectable (others greyed with tooltip "No output yet"). Select-all applies to **loaded rows only** (list is paginated / load-more); label makes that explicit.
- **Ops** `src/app/(ops)/cases/page.tsx`: add a second selection mode next to "Approve all" (they must not share state — approve mode has its own eligibility rules). Reuse existing `filtered` list.
- **Admin** `src/app/admin/(dashboard)/cases/page.tsx`: same as ops.
- Use `useMutation`-free plain form submit for the download itself; use `useQuery`/`useMutation` (TanStack, already in use) only for the manifest preflight. Toast on preflight failure.

---

## 4. Implementation steps

1. **Spike (½ day):** add `archiver` (or alternative), prove a 3 GB streamed ZIP64 from R2 stays flat in RSS behind PM2 + nginx; confirm abort cleans up. Read the Next 16 `route.md` docs first.
2. `src/lib/bulk-download/*` (access, collect, resolve-source, zip-stream, limits) + **vitest** unit tests (path sanitising, de-dupe, proxy-URL → key, legacy URL, access filtering, uploader-role filter).
3. Client routes (`manifest` + stream) + `CLIENT_OUTPUT_VISIBLE_STATUSES` constant (also wire into `CaseDetailView`'s deliverables gate (optional)).
4. Internal routes (`manifest` + stream).
5. Shared frontend pieces; then client page, then ops page, then admin page.
6. Activity-log action, Redis concurrency guard, env vars.
7. Manual test matrix (below), then update `r2-cleanup-task` header comment only if any new R2 writer is added (none planned — this feature is read-only on R2).

**No DB migration, no R2 writes, no schema change.** Indexes on `case_id` already exist for every table read.

## 5. Test matrix

- Client: own cases OK; someone else's case id in payload silently dropped; subuser resolves to parent lab; case in `in_progress` (no visible output) skipped; case with output + 5 previews; case with legacy Supabase output URL; retention-deleted object → listed in summary, rest of zip intact.
- Internal: each role allowed, milling role 403; case with scan + references + teeth library; case whose `case_files` includes designer note attachment and milling photo (must be excluded); admin-created-on-behalf case (scan included).
- Scale: 20 cases / multi-GB; browser cancel mid-download (server stops reading R2); two simultaneous downloads by same user hits the concurrency guard.
- Names: duplicate file names in one case, unicode/`..`/very long names, case number with `/`.
- Proxy: confirm no response buffering through nginx in prod (`X-Accel-Buffering: no`).

## 6. Decisions (resolved)

- **D1** Internal scope: **any case** (parity with `/api/cases/files`); no assignment restriction for designer/QC/account manager.
- **D2** Client zip **includes `case_preview_files`** under `preview/` (no toggle needed; always included).
- **D3** Internal zip has an **"include outputs" toggle (confirmed), default off**; when on, adds `output/` (`outputFile`) and `preview/` (`case_preview_files`) per case, with no status restriction for internal users.
- **D4** Client can bulk-download outputs only when status is **`submitted_to_client` (client review) or `approved`**. `CLIENT_OUTPUT_VISIBLE_STATUSES = ['submitted_to_client','approved']`, shared with the route and the manifest. Cases in any other status (incl. `delivered`, milling statuses, `change_requested`) are skipped and reported as "not available yet".
- **D5** Admin acts as Iconic side: admin can create cases and upload output/preview files. So for the internal "client/lab files" zip, **keep `admin` uploads** in `case_files` (still exclude `designer`, `qc`, `milling_*` uploaders). Note the reverse also holds: admin-uploaded output/preview files are included in the client zip (they are in `outputFile`/`case_preview_files`, which have no uploader filter).
- **D6** 20 cases / 10 GB caps; async BullMQ zip job is out of scope for v1.

## 7. Risks

- 2 GB memory cap: only safe if streaming/backpressure is correct — hence the spike first.
- Long downloads holding a Node worker on the single PM2 fork process → concurrency guard + limits.
- Retention job removing old objects → users see "missing" entries; the summary file makes this explicit rather than silent.
- Same `labName/fileName` key across cases can make two cases point at one object; the zip stays correct per-case but contents may not be the case-specific file. Pre-existing; flag separately.
