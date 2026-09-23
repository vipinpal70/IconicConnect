# Hold Images — Plan

Goal: when a case is put **on hold**, let the actor (Admin / QC / Designer) attach
up to 5 reference images explaining *why*, and add a "Preview" button at the top
of the case details page so anyone viewing the case can see those images.

v2 of this doc — after the first pass I went back and traced the feature against
the actual runtime behavior of this codebase (not just its local code path) to
find where a naive implementation would quietly misbehave. §4 is the result: real
bugs I'd hit in production, found by reading the systems this feature touches
(the orphan-cleanup job, the auth model, the download proxy), not hypotheticals.
§5 is the design corrected for them. Still no code written — for your review.

---

## 1. How cases + status transitions currently work

**Schema** ([src/db/schema/case.ts](src/db/schema/case.ts)):
- `cases.status` is a Postgres enum (`case_status`), `on_hold` is one value among ~19.
- `cases.holdReason` (`text`) stores *why* — every time a case is put on hold again,
  the new reason is **appended** to the existing one (not overwritten), separated by
  a blank line, via `appendCaseReason()` in
  [src/app/api/cases/[id]/route.ts:65](src/app/api/cases/[id]/route.ts#L65).
- There is no `case_hold_files` table today.

**Status transitions** all flow through one route,
[`PUT /api/cases/[id]`](src/app/api/cases/[id]/route.ts), which branches by
`profile.role` and enforces exactly who can move a case to `on_hold`:

| Role | Rule for `target === 'on_hold'` |
|---|---|
| `client` / `subuser` | Only from `scan_received`, `scan_not_verified`, `scan_verified` — [line 217](src/app/api/cases/[id]/route.ts#L217) |
| `admin` | Unrestricted — [line 286](src/app/api/cases/[id]/route.ts#L286) |
| `qc` | From any non-terminal status, **only if** `caseRecord.qcId === profile.id \|\| caseRecord.designerId === profile.id` — [line 352](src/app/api/cases/[id]/route.ts#L352) |
| `designer` | From any non-terminal status, self-scoped to their own case — [line 429](src/app/api/cases/[id]/route.ts#L429) |
| milling portal roles | **Cannot** set `on_hold` at all — [case-status-transitions.ts](src/lib/case-status-transitions.ts) |

Note the QC/designer rule isn't just "any QC" — it's *the QC or designer assigned
to this specific case* (or admin). That ownership scoping matters later (§4.3).

**Hold reasons today** ([HOLD_REASONS](src/lib/case-utils.ts#L29)) are mostly
scan/data-quality issues — *"Scan has artifacts", "Bite is not Aligned", "Margin
is not good"* — exactly what a photo clarifies well.

**The Hold dialog today** is inline in
[CaseDetailView.tsx](src/components/CaseDetailView.tsx) (~[line 1624](src/components/CaseDetailView.tsx#L1624)):
a `Select` of `HOLD_REASONS` + optional "Other" `Textarea`. `handleConfirmHold()`
calls `handleStatusChange("on_hold", finalReason)` → one
`PUT /api/cases/[id]` with `{ status: "on_hold", holdReason }`.

---

## 2. Existing patterns I'm reusing, not reinventing

### a) `case_preview_files` — images attached to an *existing* case, after the fact
- Table: [case.ts:241](src/db/schema/case.ts#L241). Routes: `GET/POST /api/cases/[id]/preview-files`, `DELETE .../preview-files/[fileId]`.
- Upload gate: `UPLOAD_ROLES = new Set(['admin', 'qc', 'designer'])` — but **not**
  scoped to case ownership (any QC/designer in the org can POST to any case's
  preview-files). I'm deliberately *not* copying that part — see §4.3.
- Flow: browser uploads to R2 via `uploadFileInChunks()`, then POSTs the resulting
  `{ fileUrl, fileName, fileType, fileSize }` metadata to the route.

### b) `case_reference_files` — up to 5 images, only at case-*creation* time
- Table: [case.ts:259](src/db/schema/case.ts#L259). Capped at 5
  (`MAX_REFERENCE_IMAGES`), image-only.
- Viewed via a **"Preview" button** opening a full-screen carousel `Dialog` with
  arrow-key navigation — [CaseDetailView.tsx:1886](src/components/CaseDetailView.tsx#L1886).
  This is the UI I'm cloning for the hold-images preview button.

Both keep their table separate from `case_files` so these images never leak into
the client-facing "Case Files" list or its duplicate-detection check. Hold images
get the same treatment.

`uploadFileInChunks()` ([upload-utils.ts](src/lib/upload-utils.ts)) is the one
browser→R2 upload primitive used everywhere in this app — presigned multipart
upload straight to Cloudflare R2. I'm using it unchanged.

---

## 3. What "a senior engineer's pass" actually means here

Not a rewrite for its own sake — the two features above already got the *steady-state*
design right (separate table, role gate, carousel viewer). What they didn't need
to think hard about, because their use case didn't force it, is exactly what
this feature forces:

- Reference images are attached **before the case row even exists** — there's no
  way to "cancel" and leave a dangling reference, because nothing is committed
  until the whole case POST succeeds.
- Preview files are attached by staff working the case, one at a time, with no
  particular urgency about *when* — there's no "abort this action" moment
  analogous to closing the Hold dialog.

Hold images sit in the one spot those two didn't: **images attached mid-way
through a modal dialog that itself can be committed or cancelled.** That's where
the edge cases live. I traced the actual systems this touches (not just this
component) to find them.

---

## 4. Edge cases found by tracing the real system

### 4.1 — Silent data loss: the R2 orphan-cleanup job doesn't know this table exists

This is the most important thing in this document. There's an active, scheduled
job, [`runR2Cleanup()`](src/lib/queue/r2-cleanup-task.ts), that:
1. Reads every `fileUrl` from `caseFiles`, `casePreviewFiles`, `caseReferenceFiles`,
   `cases` (output/preview/teeth-library), and `chatMessages`.
2. Lists every object actually in the R2 bucket.
3. **Deletes any object not referenced by step 1**, once it's older than a
   2-hour grace period ([r2-cleanup-task.ts:31](src/lib/queue/r2-cleanup-task.ts#L31)).

It's an allow-list reaper, running on a schedule
([r2-cleanup-scheduler.ts](src/lib/queue/r2-cleanup-scheduler.ts)), in production,
today. If I add `case_hold_files` and *don't* add it to this job's reference set,
every hold image ever uploaded gets **silently deleted from R2 two hours later** —
the feature would appear to work (thumbnail shows right after upload, within the
grace period) and then quietly break for anyone who looks at an older case. This
is exactly the kind of bug that's invisible in a demo and shows up as a support
ticket three weeks later.

**Fix (required, not optional):** add to `r2-cleanup-task.ts`:
```ts
import { caseHoldFiles } from '../../db/schema/case'; // add to existing import
...
const holdFileRows = await db.select({ fileUrl: caseHoldFiles.fileUrl }).from(caseHoldFiles);
holdFileRows.forEach((r) => protect(r.fileUrl));
```
(One line added to the `Promise.all` + one `forEach` — trivial, but only if
someone remembers to do it, which is the point of writing it down here.)

*Aside:* there's also a legacy `cleanup-task.ts` targeting Supabase Storage
directly, still scheduled via `cleanup-scheduler.ts`. It predates the R2 migration
and doesn't even include `caseReferenceFiles` today, so it's already stale —
out of scope for this feature, not making it worse, but flagging that it exists
in case it's meant to be retired.

### 4.2 — Atomicity: what happens if the Hold dialog is cancelled after images are uploaded?

My first draft of this plan uploaded each image and POSTed it to
`case_hold_files` **immediately on file selection**, before "Confirm" is clicked
— mirroring how the preview-file *replace* flow works. But that flow replaces a
file on a case that's already committed to some state; the Hold dialog is
different: the user can select images, then hit **Cancel** or click outside the
dialog, and never actually put the case on hold. With immediate-POST, those
images would already be permanent `case_hold_files` rows attached to a case that
was *never put on hold* — orphaned evidence for an action that didn't happen,
and (worse) it silently eats into the 5-image cap and the dedup check for a real
future hold.

**Fix:** stage, don't commit, until "Confirm" is clicked.
- Each selected image still uploads to R2 immediately (for a responsive progress
  bar and early failure feedback) via `uploadFileInChunks()`.
- The resulting `{ fileUrl, fileName, fileType, fileSize }` is held in **local
  component state only** (`holdImagesPending`), not sent to the database.
- **"Confirm"** sends one `PUT /api/cases/[id]` whose body now optionally
  includes `holdImages: [...]` alongside the existing `status`/`holdReason`. The
  route inserts the `case_hold_files` rows in the **same DB transaction** as the
  status update — status and evidence become atomic; you can't have one without
  the other.
- If the user cancels instead: nothing was ever written to `case_hold_files`, so
  there's nothing to clean up in the app. The R2 objects that *were* uploaded
  become genuinely unreferenced — and that's fine, because §4.1's grace-period
  reaper (once it also covers `case_hold_files`) removes them within a few hours,
  the same way it already handles every other abandoned-upload case in this app
  (its own doc comment literally says *"an upload completed but the
  case/attachment record was never committed (abandoned form...)"* — this is that
  exact scenario, already designed for). No new cleanup code needed — just don't
  fight the mechanism that already exists.
- Bonus: removing a staged (not-yet-confirmed) image from the thumbnail strip is
  now a pure client-side splice — no `DELETE` call needed, since nothing was
  persisted yet.

This also means the "5 image cap" and "duplicate name+size" checks only need to
run **once, server-side, at Confirm time** — against `existing rows + this
batch`, and *within* the batch itself (in case the same file was picked twice in
one session) — rather than being split across N separate POST calls with their
own race windows.

### 4.3 — Authorization: "any QC/designer" vs "the QC/designer on this case"

`preview-files` lets *any* profile with role `qc`/`designer`/`admin` upload to
*any* case, regardless of whether they're assigned to it. That's a pre-existing,
accepted gap for preview files (design deliverables — arguably fine for any
staff to attach).

Hold images are different: they're evidence for an action (`on_hold`) that the
route *already* restricts to the assigned QC/designer, or admin (table in §1).
If I gate image upload with the looser "any QC/designer" rule, a QC lead with no
relationship to a case could attach images to a hold action they have no
authority to take, which is a real inconsistency — the same request could be
rejected for the status change but accepted for the evidence attached to it.

**Fix:** this falls out for free from the §4.2 redesign. Since `holdImages` now
rides inside the same `PUT /api/cases/[id]` body as `status: "on_hold"`, it's
authorized by the *exact same* ownership check already enforced for the status
transition itself (lines 352/429) — no separate authorization logic needed for
upload at all. I'll apply the same ownership check explicitly to the `DELETE
.../hold-files/[fileId]` route (post-hoc removal), since that one *is* a
standalone action outside the PUT and needs its own gate — mirroring §1's table:
admin always allowed, QC/designer only if `caseRecord.qcId === profile.id ||
caseRecord.designerId === profile.id`.

### 4.4 — Multiple hold cycles: images from hold #1 and hold #3 sit in one flat, unlabeled gallery

`holdReason` already accumulates across repeat holds (case flagged, resumed,
flagged again — text just grows). If I give `case_hold_files` the identical flat
shape (no `holdEventId`/round number), the same thing happens to images: put a
case on hold three times for three different reasons, and the Preview carousel
shows all images from all three holds as one undifferentiated set, with nothing
tying "this photo" to "that paragraph" in the accumulated reason text.

This is a real usability gap for anyone auditing hold history later, but adding
a proper `holdEventId` (foreign-keying images to a specific status-change/timeline
entry) is a meaningfully bigger change — `cases.timeline` (a `CaseTimelineEvent[]`
jsonb array) doesn't currently assign stable IDs to hold transitions that a
foreign key could reference cleanly.

**Recommended v1 mitigation (cheap, ships now):** don't restructure the data
model — just don't hide the timestamp. Show each image's `createdAt` (already a
column) and uploader name in the carousel/thumbnail strip, sorted newest-first.
A viewer can already correlate "these 2 photos, dated the 14th" against the
hold-reason paragraph appended around the same date, without new schema.
**v2, if repeat-holds-with-different-reasons turns out to be common in
practice:** add a `holdRound` integer (incremented each time the case re-enters
`on_hold` from a different status) to both `case_hold_files` and a parallel
structured-reason table — bigger change, deliberately deferred.

### 4.5 — Duplicate detection: what "same image" means, and its limits

Per your ask, I'm rejecting a second copy of the same image within one case.
Chosen heuristic: `fileName` + `fileSize` match against existing `case_hold_files`
rows for that `caseId`, checked server-side at Confirm time (§4.2), plus a
client-side pre-check against both the already-loaded gallery *and* other files
staged earlier in the same dialog session (so picking the same file twice in one
go is also caught before two uploads even start).

**Explicitly not** doing byte-level content hashing (`SHA-256` of file contents)
for v1 — this codebase's existing duplicate-detection precedent
([case-duplicate.ts](src/lib/case-duplicate.ts), used for 3Shape-import zip
dedup) is also a cheap heuristic (normalized name + tooth-set overlap), not a
hash, so name+size is consistent with the bar already set here. Trade-off to be
explicit about: renaming a copy of the same photo defeats this check. If that
turns out to matter, swap in `crypto.subtle.digest('SHA-256', await
file.arrayBuffer())` client-side, store as a `fileHash` column, dedup on that —
isolated, additive change, not a redesign.

### 4.6 — Format: HEIC photos won't render for most viewers

QC/designers are likely to attach phone photos. iPhones default to HEIC. HEIC
has no native decoder in Chrome/Firefox/Edge on Windows or Linux (only
Safari/macOS/iOS decode it natively) — so a HEIC hold image would show as a
broken image icon for the majority of internal staff and every client viewing
from a non-Apple device. This is a real, likely-to-happen support complaint in a
dental-lab context, not a theoretical one.

Both `validateReferenceImage` (reference images) and my earlier draft used a
blanket `file.type.startsWith("image/")` check, which accepts HEIC
(`image/heic`) — an existing soft spot in the reference-images feature too, but
I'm not touching that one; I can tighten it for hold images since I'm building
this from scratch:

**Fix:** allow-list `image/jpeg`, `image/png`, `image/webp` explicitly (reject
everything else, including HEIC and SVG, with a clear client-side error —
*"Please use JPG, PNG, or WEBP — HEIC photos from iPhone aren't supported yet,
convert or take a screenshot instead"*). No server-side transcoding pipeline
exists in this codebase (no image-processing library present) and adding one is
real scope creep for what should be a lightweight evidentiary photo — rejecting
early with a clear message is the proportionate v1 answer.

### 4.7 — SVG as a stored-XSS vector — mostly already mitigated, tightened anyway

`image/svg+xml` technically passes an `image/*` check but is executable XML.
Checked whether this is actually exploitable here: the download proxy
([`/api/cases/files`](src/app/api/cases/files/route.ts#L96)) serves every
non-`.html` file — which includes images — with `Content-Type:
application/octet-stream` and `Content-Disposition: attachment`. Both headers
are ignored by `<img>` tags (browsers sniff magic bytes for inline rendering
regardless of a generic declared type), which is *why* the existing
reference/preview images already render correctly despite this. But
`Content-Disposition: attachment` **does** force a download rather than inline
execution on direct navigation to the URL — so even an SVG with embedded
`<script>` can't execute just by someone opening the raw `fileUrl` in a new tab;
it downloads instead. Net: already substantially mitigated by an existing,
unrelated header choice. The §4.6 allow-list excludes SVG anyway as a side
effect, so this is defense-in-depth, not an open hole — noting it so the
reasoning is on record rather than assumed.

### 4.8 — Privacy: raw uploads keep embedded EXIF (including GPS)

Uploads go straight from the browser to R2 as raw bytes — no client-side
re-encode step exists anywhere in this app's upload path — so a phone photo's
EXIF block (capture location, device info) travels with it unmodified. In a
dental-case context this is adjacent-to-PHI data handled by a healthcare-adjacent
business; it's worth flagging even though the *photo subject* here is scan/bite
quality, not a patient's face. **Not proposing to build EXIF-stripping for v1**
(no precedent for it anywhere else in this codebase's upload paths either, so it
would be a new, broader capability, not a hold-images-specific fix) — flagging it
as a known trade-off so it's a deliberate decision, not an oversight.

### 4.9 — Concurrency: two people confirming a hold on the same case at once

With the §4.2 redesign, the "5 image cap" and dedup checks are `SELECT count(...)
/ SELECT existing rows` followed by an `INSERT`, inside one request — not
atomic against a second request racing it. Two people (e.g. QC and admin) would
need to open the same case's Hold dialog and hit Confirm within milliseconds of
each other to hit this, which is a narrow window for what's normally a
single-actor action. This is the **same class of race** the existing
`preview-files` route already has (count-check-then-insert, not
transaction-serialized) and the codebase has evidently accepted that risk level
elsewhere. Matching that precedent rather than gold-plating just this one route.
If it ever matters: wrap the count-check + insert in one `SERIALIZABLE`
transaction, or add a Postgres trigger enforcing the cap — isolated hardening,
not a blocker for v1.

### 4.10 — Storage-key stability: why `caseId`, not `caseNumber`

Confirmed by reading the route: admins can edit `caseNumber` after creation
(`if (body.caseNumber) updateData.caseNumber = body.caseNumber` — [route.ts:279](src/app/api/cases/[id]/route.ts#L279)).
If the R2 key path used `caseNumber`, renaming a case would either orphan
already-uploaded images (new uploads go to a different folder than old ones) or
require a bulk R2 rename on every case-number edit. `cases.id` (UUID, immutable,
already in scope at upload time) has neither problem. This settles what was an
open question in v1 of this doc — not a style preference, a correctness
requirement once you trace what "editable case number" actually implies.

### 4.11 — Lab scoping must be explicit, not inferred

`uploadFileInChunks(file, { clientId }, ...)` — if `clientId` is omitted, the
upload route resolves it from the *uploader's own* profile
([upload/route.ts:44](src/app/api/cases/upload/route.ts#L44):
`clientId = adminClientId || profile.id`). For a case-scoped upload performed by
an admin/QC/designer, the file must be filed under the **case's owning client's**
lab folder, not the staff member's own — so `clientId: caseRecord.clientId` must
always be passed explicitly. (This was already correct in v1 of this plan; noting
*why* it's correct, since getting this wrong would misfile every hold image under
the wrong lab, which existing tooling like `getProfileLabName` wouldn't catch.)

---

## 5. Revised design

### Data model — unchanged from v1

```ts
export const caseHoldFiles = pgTable('case_hold_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => profiles.id).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileType: varchar('file_type', { length: 100 }),
  fileSize: bigint('file_size', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  caseIdIdx: index('case_hold_files_case_id_idx').on(table.caseId),
}))
```
5 images total per case, accumulated across repeat holds (§4.4) — sorted/labeled
by `createdAt` + uploader in the UI as the v1 mitigation for the multi-hold-cycle
gap.

### Storage key — case- and lab-scoped (unchanged reasoning from v1, now justified by §4.10/4.11)

```ts
const storageFile = new File(
  [file],
  `hold-images/${caseRecord.id}/${crypto.randomUUID()}-${file.name}`,
  { type: file.type },
);
```
Resulting key: `${labName}/hold-images/${caseId}/${uuid}-${originalName}` —
unique per case, unique per upload, lab-scoped via an explicit `clientId:
caseRecord.clientId` passed to `uploadFileInChunks`. Display `fileName` sent to
the API stays the original (`file.name`), decoupled from the storage key.

### API routes

- **`PUT /api/cases/[id]`** (existing route, extended) — body gains an optional
  `holdImages?: Array<{ fileUrl, fileName, fileType, fileSize }>`, only
  meaningful when `status === 'on_hold'`. Same transaction as the status update:
  1. Re-validate count: `existingHoldFileCount + holdImages.length <= 5`, 400 if not.
  2. Re-validate dedup: reject (400, listing the offending names) any incoming
     item matching an existing row's `fileName`+`fileSize`, or matching another
     item *within the same incoming array*.
  3. Insert surviving rows, `uploadedBy: user.id`.
  4. Authorized by the exact same role/ownership branch already handling
     `status: 'on_hold'` for that role (§4.3) — no new auth code.
- **`GET /api/cases/[id]/hold-files`** — unchanged from v1: read-only, returns
  all rows newest-first, same case-access auth as `preview-files`/`reference-files`.
  Backs the `useQuery` powering the top-bar Preview button + carousel.
- **`DELETE /api/cases/[id]/hold-files/[fileId]`** — post-hoc removal. Gate:
  admin, or the QC/designer currently assigned to the case (§4.3) — **not** the
  looser `preview-files` "any QC/designer" rule. R2 object left for the existing
  orphan reaper (now that §4.1 registers this table with it).

### Frontend — `CaseDetailView.tsx`

**Hold dialog** gets a staged (not immediately committed) image picker:
- Local state: `holdImagesPending: Array<{fileUrl, fileName, fileType, fileSize}>`,
  reset whenever the dialog opens (alongside the existing
  `holdReasonSelect`/`holdCustomReason` reset).
- On file select: image-type allow-list (§4.6) → remaining-slot count → dedup
  against both the loaded `case-hold-files` query *and* `holdImagesPending` →
  upload survivors via the case-scoped `uploadFileInChunks` call → append to
  `holdImagesPending` (not POSTed anywhere yet). Thumbnail strip with a
  client-side-only remove (×) — no network call, just a splice, since nothing's
  persisted (§4.2).
- "Confirm" is disabled while any image is still uploading (mirrors
  `isUploadingReferenceImages` gating `AddCaseDialog`'s submit). On click, the
  existing `handleStatusChange("on_hold", finalReason)` call gains a third
  argument: the current `holdImagesPending` array, folded into the one
  `PUT /api/cases/[id]` body.
- Upload section only renders when `chatSide === "admin"` (Admin/QC/Designer
  portals) — clients never see it.

**Top-of-page Preview button**, next to `StatusBadge` in the header row
([line 857](src/components/CaseDetailView.tsx#L857)), visible to every viewer
(including clients — same reasoning as the existing hold-reason banner) whenever
`holdImages.length > 0`; opens a carousel cloned from the Reference Images one
([line 1886](src/components/CaseDetailView.tsx#L1886)), each slide labeled with
uploader + date (§4.4's mitigation).

**Data fetching**: `useQuery(["case-hold-files", caseId], ...)` against the new
`GET` route, invalidated alongside the other case queries inside
`handleStatusChange`.

---

## 6. Files touched (updated)

| File | Change |
|---|---|
| `src/db/migrations/0055_case_hold_files.sql` | new table |
| `src/db/schema/case.ts` | add `caseHoldFiles` table + types |
| `src/app/api/cases/[id]/route.ts` | extend `PUT` to accept + transactionally insert `holdImages` (§5) |
| `src/app/api/cases/[id]/hold-files/route.ts` | new — `GET` only (no `POST`; writes happen via the `PUT` above) |
| `src/app/api/cases/[id]/hold-files/[fileId]/route.ts` | new — `DELETE`, ownership-gated (§4.3) |
| `src/lib/queue/r2-cleanup-task.ts` | **required** — register `caseHoldFiles.fileUrl` in the reference set (§4.1) |
| `src/components/CaseDetailView.tsx` | Hold dialog staged-upload UI, top-bar Preview button, carousel, `case-hold-files` query |

No changes needed to `activity-log.ts`/`notification-dispatcher.ts` — existing
generic "Case put on hold" copy is fine as-is.

---

## 7. Decisions still open

Most of v1's open questions got resolved by tracing the actual system (§4) rather
than needing your input — listing what's left:

1. **Multi-hold-cycle correlation (§4.4)** — shipping the cheap
   timestamp/uploader-label mitigation for v1, deferring a real `holdRound`
   schema change unless repeat-holds-with-different-reasons turns out to be
   common. Agree, or is this common enough today to build properly now?
2. **Dedup strength (§4.5)** — name+size heuristic, not content hash. Fine, or
   worth the extra `fileHash` column now?
3. **HEIC/format rejection (§4.6)** — rejecting HEIC outright with a message
   telling the user to convert, rather than building server-side transcoding.
   Acceptable, or does iPhone-camera HEIC come up often enough to warrant the
   bigger lift?

Everything else in §4 (R2 cleanup registration, atomicity via staged uploads,
ownership-scoped auth, `caseId` for the storage path, explicit `clientId`) I'm
treating as settled by the tracing itself, not preference — happy to discuss any
of them further if something reads wrong.

Once confirmed: migration → schema → `PUT` route extension → `hold-files` GET/DELETE
routes → R2 cleanup registration → frontend staged-upload UI → preview
button/carousel → manual test of the full hold → confirm → cancel-mid-upload
paths in the browser.
