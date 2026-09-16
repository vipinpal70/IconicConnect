# Case Creation Flow — Modification Plan

Scope: three changes to the case-creation flow described in the earlier
read-through of `POST /api/cases` and its five UI callers (AddCaseDialog,
client cases page single + bulk, ops cases page single + bulk, 3Shape
XML import).

1. `modelRequired` — no more silent default; client/lab must explicitly
   choose Yes/No, enforced in UI **and** API.
2. Reference images — up to 5, optional, uploadable at case-creation time.
3. Narrow required-to-submit fields down to **File + Category + Tooth
   Number** only; every category sub-type dropdown (Case Type, Arch,
   Occlusion, Die, Articulator, …) becomes optional.

Each section below has: current behavior, target behavior, every file
touched, and the specific edit. A **Risks / open decisions** section at
the end covers the one change (#3) that has real knock-on effects on
billing and needs a decision from you before I implement it.

---

## 1. `modelRequired` — force an explicit choice

### Current behavior

- State default is `"no"` everywhere it's declared:
  - [AddCaseDialog.tsx:54](src/components/AddCaseDialog.tsx#L54) — `useState("no")`
  - [client/(dashboard)/cases/page.tsx:319](src/app/client/(dashboard)/cases/page.tsx#L319) — `useState("no")`
  - [(ops)/cases/page.tsx:740](src/app/(ops)/cases/page.tsx#L740) — `useState("no")`
  - Bulk rows in both pages default each row to `modelRequired: "no"` on creation.
  - [three-shape/map-to-case.ts:228](src/lib/three-shape/map-to-case.ts#L228) — `subTypeData.modelRequired = options.modelRequired ?? 'no'` (defaults silently, pushes a warning but still proceeds).
- It's rendered as a `RadioGroup` with only two items (`yes`/`no`), so there is no "unselected" visual state — it's always shown as "No" selected, and a user who never touches it submits a false negative.
- None of the three client-side validators (`hasAllRequiredCaseFields` in the client page, the ops page, and `draftValid` in 3Shape) check `modelRequired` at all — it's absent from the `fields` array in `CASE_HIERARCHY`, since it isn't a category/sub-type selector, it's separate case metadata appended in `subTypeData` at submit time.
- Server (`POST /api/cases`) never inspects `modelRequired` — it's opaque `subTypeData` JSON to the API route. [getRequiredServiceSelections](src/lib/case-hierarchy.ts#L83) doesn't look at it either (Model billing is a separate flat per-case add-on, not a `service_catalog` row).
- It's excluded from category `3D Model` (that category has its own Die/Articulator/Drain Holes flags and never sets `modelRequired` — see the comment at [invoice.ts:262](src/lib/invoice.ts#L262)).

### Target behavior

- Default state becomes **unset** (`null`), not `"no"`.
- The Yes/No radio group must present a genuine third "unselected" state (no radio pre-checked).
- Submitting with `modelRequired` still `null` is blocked, client-side (button disabled or a toast) **and** server-side (400), for every non-`3D Model` category.
- `3D Model` category cases continue to omit `modelRequired` entirely (unchanged — it already doesn't apply there).

### Files to change

**a) `src/components/AddCaseDialog.tsx`**
- Line 54: `useState("no")` → `useState<"yes" | "no" | null>(null)`.
- Line ~189 (dialog reset-on-open effect): `setModelRequired("no")` → `setModelRequired(null)`.
- Lines 769 and 943 (`RadioGroup value={modelRequired}`): with `value={null}` Radix's `RadioGroup` already renders with nothing checked, so no markup change needed beyond the type — but add a small "Required" marker/asterisk next to the label so it reads as mandatory, matching how other required fields are styled in this form.
- Line ~495 (validation block before submit): add `modelRequired === null` (for non-`3D Model` categories) to the failing condition alongside `allFieldsFilled`/`teethValid`, with its own toast message so the user isn't stuck guessing which field is missing (e.g. `"Please specify whether a model is required."`).
- Line ~499 (`caseData.subTypeData`): still spreads `modelRequired` as-is — no change needed there since by the time we reach this line validation has already guaranteed it's `"yes"`/`"no"` for non-3D-Model, and 3D Model never sets it (need to explicitly omit it when `category === "3D Model"` — check current code; today it always includes it, which is harmless since nothing reads it for that category, so leave as-is to minimize blast radius, OR omit for cleanliness — flagging as a judgment call, default: leave it, since it's inert today).

**b) `src/app/client/(dashboard)/cases/page.tsx`**
- Line 319: `useState("no")` → `useState<"yes" | "no" | null>(null)`.
- Line 44 (`BulkRow` type): `modelRequired: "yes" | "no"` → `modelRequired: "yes" | "no" | null`.
- Line 726 (bulk row factory defaults): `modelRequired: "no"` → `modelRequired: null`.
- `hasAllRequiredCaseFields` (line 133): add a `modelRequired: "yes" | "no" | null` parameter; return `false` when it's `null` and `category !== "3D Model"`.
- Line 629 call site: pass `modelRequired` in.
- Line 769 call site (bulk): pass `row.modelRequired` in — `hasInvalidRow` check already iterates `bulkRows`.
- Reset-on-success block (~line 686 area, after successful `handleSubmit`): `setModelRequired("no")` → `setModelRequired(null)`.
- RadioGroup renders at lines 1081, 1240, 1564 — same "no change needed, Radix handles `null`" as above; add the required-marker styling.

**c) `src/app/(ops)/cases/page.tsx`**
- Line 740: `useState("no")` → `useState<"yes" | "no" | null>(null)`.
- `hasAllRequiredCaseFields` (line 216): same signature addition as above.
- Lines 971/1010/1032 (single + bulk submit and reset): thread `modelRequired` through and reset to `null` instead of `"no"`.
- Note: this page's `CASE_HIERARCHY` copy still says `"Crown & Bridges"` (plural, line 986) — pre-existing bug, unrelated to this change, not touching it here unless you want it folded in.

**d) `src/components/ThreeShapeImport/DraftCaseForm.tsx`**
- Line 21: `modelRequired?: "yes" | "no"` → `modelRequired?: "yes" | "no" | null`.
- Line 101 (`value={subTypeData.modelRequired === "yes" ? "yes" : "no"}`): this line currently **collapses "unset" into "no"** for display purposes — that's exactly the bug we're removing. Change to `value={subTypeData.modelRequired === "yes" ? "yes" : subTypeData.modelRequired === "no" ? "no" : undefined}` so an unset value shows unchecked.

**e) `src/components/ThreeShapeImport/ThreeShapeImport.tsx`**
- Line 515 (category-change handler): `modelRequired: category === "3D Model" ? undefined : "no"` → `... : null` (keep "unset", don't pre-fill "no").
- `draftValid` in [draft-logic.ts:47](src/components/ThreeShapeImport/draft-logic.ts#L47): add a check — for `d.category !== "3D Model"`, `d.subTypeData.modelRequired` must be `"yes"` or `"no"` (not `null`/`undefined`). This is the single shared validator gating the "Submit" button and the "jump to first invalid draft" behavior in `submitAll`, so one change here covers the whole 3Shape review carousel.
- Existing tests in [draft-logic.test.ts](src/components/ThreeShapeImport/__tests__/draft-logic.test.ts) already set `modelRequired: 'no'` explicitly in every fixture — they'll keep passing; add one new test case asserting a draft with `modelRequired: null` (or key omitted) and category `!== '3D Model'` is invalid.

**f) `src/lib/three-shape/map-to-case.ts`**
- Line 228: currently defaults to `'no'` when the scan doesn't tell us (with a warning pushed). Per this change, **XML-extracted drafts should also come through as unset**, forcing the client to actively choose on the review screen rather than silently defaulting — change `subTypeData.modelRequired = options.modelRequired ?? 'no'` to `subTypeData.modelRequired = options.modelRequired ?? null` and update the warning message (currently says "defaulted to 'no'"; change to "not detected — please confirm on the review screen"). This keeps the `MODEL_REQUIRED_DEFAULTED` warning-surfacing behavior (still flags it for review) but stops it from being submittable without the user looking at it, since `draftValid` will now reject `null`.
- Update the JSDoc at line 10 ("Q5: `modelRequired` always defaults `"no"` + flag") to reflect the new behavior.

**g) Server: `src/app/api/cases/route.ts`**
- In the per-case loop (~line 260, after the `modelOnlyLab` check and before the price-list enablement check), add:
  ```ts
  if (caseData.category !== '3D Model') {
    const mr = (caseData.subTypeData as { modelRequired?: unknown } | undefined)?.modelRequired;
    if (mr !== 'yes' && mr !== 'no') {
      return NextResponse.json(
        { error: 'Please specify whether a model is required for this case.' },
        { status: 400 }
      );
    }
  }
  ```
  This is the authoritative guard — it protects the mobile/API-client JSON path too (which bypasses the web UI entirely), not just the three web forms.

### Downstream reads — confirmed unaffected

These all already handle `modelRequired !== 'yes'` as "no model" (falsy check, not an explicit `=== 'no'` check), so forcing the value to always be `'yes'`/`'no'` (never missing) going forward doesn't break them — it just makes the data more trustworthy for **future** cases. Existing cases in the DB that already have `modelRequired: undefined` or absent are untouched (this is a validation-only change, no backfill):
- [invoice.ts:333](src/lib/invoice.ts#L333) — `if (data.modelRequired !== 'yes') continue`
- [billing/clients/[clientId]/route.ts](src/app/api/billing/clients/[clientId]/route.ts) — same pattern, 5 call sites
- [milling/case-view.ts:38](src/lib/milling/case-view.ts#L38) — `data.modelRequired === 'yes'`
- [CaseDetailView.tsx:787](src/components/CaseDetailView.tsx#L787), [admin/(dashboard)/cases/page.tsx:1957](src/app/admin/(dashboard)/cases/page.tsx#L1957), [admin/(dashboard)/billing/page.tsx:277](src/app/admin/(dashboard)/billing/page.tsx#L277) — display-only, unaffected.

No migration needed — `modelRequired` lives inside the `sub_type_data` JSONB blob, not a typed column.

---

## 2. Reference images — up to 5, optional

### Design choice: new table, mirroring `case_preview_files`

The existing `case_files` table is reserved for the client's **input scan
files** (what gets matched for duplicate detection, what shows in the
client-facing "Case Files" list). The codebase already drew this exact
line once before — `case_preview_files` was split out from `case_files`
specifically so preview deliverables wouldn't leak into the scan-files
list (see the comment at [case.ts:216](src/db/schema/case.ts#L216) and
the migration note in
[0051_case_preview_files.sql](src/db/migrations/0051_case_preview_files.sql)).
Reference images are a third, distinct concept (client-supplied visual
reference — photos of the patient's bite, shade, an example restoration,
etc.) and deserve the same treatment: a **new `case_reference_files`
table**, not overloading `case_files`.

Rejected alternative: reusing `case_files` with a `fileKind` discriminator
column. Rejected because every existing query against `case_files`
(duplicate-detection in `route.ts`, the scan-file list in `GET /api/cases`,
`bulk/confirm/route.ts`, R2 cleanup) would need an added `WHERE fileKind =
'scan'` filter to avoid silently picking up reference images — much larger
and riskier surface area than adding one new table.

### Schema — new migration `0052_case_reference_files.sql`

```sql
-- Reference images uploaded by the client/lab at case-creation time (up to
-- 5, optional). Kept as its own table, not reusing case_files, so they
-- never leak into the "Case Files" (input scan) list or the file-name
-- duplicate-detection check in POST /api/cases — mirrors the reasoning in
-- 0051_case_preview_files.sql for design-side previews.
CREATE TABLE IF NOT EXISTS "case_reference_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_type" varchar(100),
	"file_size" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "case_reference_files" ADD CONSTRAINT "case_reference_files_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_reference_files" ADD CONSTRAINT "case_reference_files_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_reference_files_case_id_idx" ON "case_reference_files" ("case_id");
```

Generated the standard way: add the Drizzle table definition first, then
run `npm run db:generate` (drizzle-kit) to produce the migration + journal
entry rather than hand-writing it — the SQL above is what it will produce,
shown for review purposes. Applied via `npm run db:migrate`.

### Drizzle schema — `src/db/schema/case.ts`

Add alongside `casePreviewFiles` (after line ~230):

```ts
export const caseReferenceFiles = pgTable('case_reference_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => profiles.id).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileType: varchar('file_type', { length: 100 }),
  fileSize: bigint('file_size', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  caseIdIdx: index('case_reference_files_case_id_idx').on(table.caseId),
}))

export type CaseReferenceFile = typeof caseReferenceFiles.$inferSelect
export type NewCaseReferenceFile = typeof caseReferenceFiles.$inferInsert
```

### Upload mechanism — reuse the existing R2 multipart route

No new upload endpoint needed. Reference images go through the exact same
`uploadFileInChunks()` / `/api/cases/upload` (`init` → `sign` → PUT parts
→ `complete`) flow already used for the main case file(s) — it's already
generic over file type/size, just capped at 5 GB (way more than any
image needs, so no limit change required there). This keeps upload
progress UI, R2 CORS, and the auth-protected `/api/cases/files` download
proxy all working for reference images for free, with zero backend
upload-path changes.

The only new client-side constraint layered on top: restrict the file
picker's `accept` to images (`image/*` or an explicit list — `.jpg .jpeg
.png .webp .heic`) and cap the count at 5, rejecting extra picks with a
toast (mirrors how `AddCaseDialog`'s `validateFile()` already rejects
oversized/blocked-extension files before calling `uploadFileWithXHR`).

### API — `POST /api/cases` request/response shape

**Request** — add one new optional field to `CasePayload` in
[route.ts:63](src/app/api/cases/route.ts#L63):

```ts
referenceImages?: Array<{ fileName: string; fileUrl: string; fileType: string; fileSize: number }>;
```

**Server validation** (in the per-case loop, right after the case insert,
near where `uploadedFiles`/`uploadedFile` are inserted into `caseFiles`):

```ts
if (Array.isArray(caseData.referenceImages) && caseData.referenceImages.length > 0) {
  if (caseData.referenceImages.length > 5) {
    return NextResponse.json({ error: 'A maximum of 5 reference images is allowed per case.' }, { status: 400 });
  }
  for (const img of caseData.referenceImages) {
    await db.insert(caseReferenceFiles).values({
      caseId: insertedCase.id,
      uploadedBy: user.id,
      fileName: img.fileName,
      fileUrl: img.fileUrl,
      fileType: img.fileType ?? null,
      fileSize: img.fileSize ? Number(img.fileSize) : null,
    });
  }
}
```

Import `caseReferenceFiles` from `@/src/db/schema/case` at the top of the
file. Since this field is entirely optional and additive, it doesn't
interact with the existing duplicate-detection logic (which only ever
looks at `uploadedFile`/`uploadedFiles`) — intentionally: a reference
image shouldn't trigger a "you already uploaded this file" 409.

### Reading reference images back — new endpoint, mirroring preview-files

Add `src/app/api/cases/[id]/reference-files/route.ts` with `GET` (list)
and `POST` (add one after case creation, if you want labs to attach more
later — optional, ask before building) — closely mirroring
[`[id]/preview-files/route.ts`](src/app/api/cases/[id]/preview-files/route.ts):
same auth/ownership check pattern (`effectiveClientId` for
client/subuser, unrestricted for staff roles), same `GET` shape
`{ data: CaseReferenceFile[] }`. A `DELETE` at
`[id]/reference-files/[fileId]/route.ts` mirrors
[`[id]/preview-files/[fileId]/route.ts`](src/app/api/cases/[id]/preview-files/[fileId]/route.ts)
for removing one before the case ships (governed by the same
`EDITABLE_STATUSES` gate other pre-work edits use, if you want editing
restricted the same way — flagging as a decision, see below).

### UI — case-creation forms

In each of the three creation forms (`AddCaseDialog`, client cases page,
ops cases page — bulk rows optionally excluded initially, see decision
below), add:
- A new "Reference Images (optional)" section below the main file-upload
  dropzone, same drag-and-drop pattern as the existing "Teeth Library"
  upload (small, secondary upload zone).
- State: `referenceImages: Array<{fileUrl, fileName, fileSize, fileType}>`
  (array, not single file, mirroring `uploadedFilesList`).
- Enforce max 5 client-side (disable/hide the dropzone once 5 are
  attached, with a counter "3/5").
- Thumbnail preview grid with a per-image remove (X) button, calling the
  same `/api/cases/files?labName=…&fileName=…` `DELETE` pattern
  `handleDeleteUploadedFile` already uses for the main file.
- On submit, include `referenceImages: referenceImages` in the JSON
  payload alongside `uploadedFiles`.
- **Not required for form validity** — omitted entirely from
  `hasAllRequiredCaseFields`/`draftValid`.

### Display — case detail view

`CaseDetailView.tsx` already renders the preview-file carousel
(`case-preview-files` query, ~[line 733](src/components/CaseDetailView.tsx#L733))
and the plain "Case Files" list (~[line 950](src/components/CaseDetailView.tsx#L950)).
Add a third, small "Reference Images" section — a lightweight thumbnail
strip (not a full carousel — these are client-supplied inspiration/
reference, not the deliverable) — fetching `GET
/api/cases/[id]/reference-files`, shown to every role that can already
see the case (no extra permission logic needed, same visibility as
`Case Files`).

### R2 lifecycle — cleanup/retention tasks

[r2-cleanup-task.ts:66-67](src/lib/queue/r2-cleanup-task.ts#L66-L67)
builds its "referenced URLs" set from `caseFiles` and `casePreviewFiles`
so it knows which R2 objects are still in use and safe to leave alone
(anything *not* in that set is a cleanup candidate). Add
`caseReferenceFiles` to that same `Promise.all` query list, or objects
backing reference images will look orphaned and get deleted by the
cleanup job shortly after a case is created. This is a **required**
change, not optional — easy to miss since it's not on the main
create-case code path at all.

---

## 3. Only File + Category + Tooth Number required to submit

### Current behavior (all three forms + 3Shape identical logic)

`hasAllRequiredCaseFields` / `draftValid` currently require:
1. `category` truthy
2. `uploadedFile` truthy (or non-empty `uploadedFiles`)
3. **Every non-optional field in `CASE_HIERARCHY[category].fields`** —
   e.g. for Crown & Bridge that's `caseType`; for Dentures, `caseType1`
   AND `caseType2` (Arch); for Appliances, `caseType1` AND `occlusion`
   AND `arch`; for Implants, `caseType1` (caseType2 is already marked
   `optional: true` in the hierarchy); for 3D Model, `caseType1`,
   `caseType2`, `articulator`, `drainHoles`, `die` (5 required selects).
4. `teeth.length > 0` (except 3D Model, where teeth are only required if
   `die === "Yes"`)
5. Implants-only: if a Crown & Bridge attachment type is chosen,
   `crownBridgeTeeth.length > 0`

### Target behavior

Only three things gate submission, for every category:
1. At least one uploaded file (`uploadedFile`/`uploadedFiles`)
2. `category` selected
3. At least one tooth selected (`teeth.length > 0`)

Every sub-type dropdown (`caseType`, `caseType1`, `caseType2`, `arch`,
`occlusion`, `articulator`, `drainHoles`, `die`) becomes **optional** —
still shown in the form (so labs can fill them in when they know the
details), but no longer blocks submission when left blank. The Implants
"Crown & Bridge attachment teeth" sub-requirement (#5 above) is dropped
along with it, since it was conditional on a now-optional field.

The existing 3D-Model carve-out ("teeth only required if Die = Yes") is
superseded by the new blanket rule — teeth become required for 3D Model
too, unconditionally, same as every other category. (Flagging this as a
behavior change worth confirming — see Risks below.)

### Files to change

**a) `src/lib/case-hierarchy.ts`** — mark every field `optional: true`:
```ts
'Crown & Bridge': { fields: [{ name: 'caseType', ..., optional: true }] },
Dentures: { fields: [
  { name: 'caseType1', ..., optional: true },
  { name: 'caseType2', ..., optional: true },
] },
Cosmetics: { fields: [{ name: 'caseType', ..., optional: true }] },
Appliances: { fields: [
  { name: 'caseType1', ..., optional: true },
  { name: 'occlusion', ..., optional: true },
  { name: 'arch', ..., optional: true },
] },
Implants: { fields: [
  { name: 'caseType1', ..., optional: true },      // was required
  { name: 'caseType2', ..., optional: true },       // already optional
] },
'3D Model': { fields: [
  { name: 'caseType1', ..., optional: true },
  { name: 'caseType2', ..., optional: true },
  { name: 'articulator', ..., optional: true },
  { name: 'drainHoles', ..., optional: true },
  { name: 'die', ..., optional: true },
] },
```
This single shared file drives all three forms' rendering AND (per the
header comment) is meant to be the "single source of truth" — but note
`fields.every((f) => f.optional || ...)` is only actually read by the
**client-side validators**, not by anything that renders the form itself
(the form always renders every field in the hierarchy regardless of
`optional`). So this edit alone doesn't relax validation — it's a no-op
until each validator function is also updated, since today's validators
loop over `CASE_HIERARCHY[category].fields` directly rather than
hardcoding field names, so flipping `optional` here should be
**sufficient** for the client page and ops page (both already do
`field.optional || Boolean(subTypeData[field.name])`) — good, minimal
diff. Double-check: [AddCaseDialog.tsx:495](src/components/AddCaseDialog.tsx#L495)
`const allFieldsFilled = fields.every((f) => f.optional || subTypeData[f.name])`
— same pattern, also automatically respects the new `optional: true`
flags. **So for the "every field optional" part, the hierarchy edit is
the whole fix in all three forms.**

**b) Teeth requirement — make unconditional (drop the 3D-Model carve-out)**

Three validators currently special-case 3D Model:
```ts
const teethValid = category === "3D Model" ? (subTypeData.die !== "Yes" || teeth.length > 0) : teeth.length > 0
```
Change to, everywhere it appears:
```ts
const teethValid = teeth.length > 0
```
- [AddCaseDialog.tsx:495](src/components/AddCaseDialog.tsx#L495)
- [client/(dashboard)/cases/page.tsx:145](src/app/client/(dashboard)/cases/page.tsx#L145) (inside `hasAllRequiredCaseFields`)
- [draft-logic.ts:55-57](src/components/ThreeShapeImport/draft-logic.ts#L55-L57) (3Shape)
- Note: [(ops)/cases/page.tsx](src/app/(ops)/cases/page.tsx)'s `hasAllRequiredCaseFields` (line 216) already has an unconditional `teeth.length > 0` with no 3D-Model carve-out — already matches the target, no change needed there.

**c) Drop the Implants crownBridgeTeeth sub-requirement**

Since `caseType2` (the Crown & Bridge attachment picker) is optional and
no longer gates submission, its dependent requirement should go too —
remove this block from `AddCaseDialog.tsx` (~line 500) and
`client/(dashboard)/cases/page.tsx` (`hasAllRequiredCaseFields`, the
`if (category === "Implants") {...}` block) and the equivalent in
`draft-logic.ts` (lines 59-69). If a lab *does* pick a Crown & Bridge
type, arguably the teeth for it should still be expected — but per your
"only File + Category + Tooth Number required" instruction, this
becomes a soft UX nicety rather than a hard gate. **Flagging as a
judgment call**: I'd keep a **non-blocking warning** ("You selected a
Crown & Bridge attachment but haven't chosen its teeth — you can still
submit, but the design team will need this detail") rather than silently
dropping the signal entirely, since it's cheap to keep and avoids a
predictable back-and-forth with the design team. Will implement it as
non-blocking unless you say otherwise.

**d) Server-side — `POST /api/cases`**

Today the server does **not** independently re-validate `subTypeData`
completeness or `teeth` at all (confirmed in the original read-through —
this was already effectively only enforced client-side). Per your
instruction ("File, category and tooth number required only to submit a
case... blocked by UI and **API as well**" — read together with change
#1's explicit API-enforcement ask), add the missing server-side guards
for the three fields that now matter, in the per-case loop of
[route.ts](src/app/api/cases/route.ts), right after the `category`/
`modelOnlyLab` checks:

```ts
if (!caseData.category) {
  return NextResponse.json({ error: 'Category is required.' }, { status: 400 });
}
const hasFile = Boolean(caseData.uploadedFile) || (Array.isArray(caseData.uploadedFiles) && caseData.uploadedFiles.length > 0) || Boolean(files[i]);
if (!hasFile) {
  return NextResponse.json({ error: 'At least one case file is required.' }, { status: 400 });
}
const teethArr = (caseData.subTypeData as { teeth?: unknown } | undefined)?.teeth;
if (!Array.isArray(teethArr) || teethArr.length === 0) {
  return NextResponse.json({ error: 'At least one tooth selection is required.' }, { status: 400 });
}
```
This closes the gap for the JSON/mobile-client path, which today has
zero server-side field enforcement and relies entirely on whichever
client happens to call it behaving correctly.

### Downstream impact — billing (needs your decision, see Risks)

`getRequiredServiceSelections()` in
[case-hierarchy.ts:83](src/lib/case-hierarchy.ts#L83) reads
`subTypeData.caseType`/`caseType1`/`caseType2` to build the list of
`service_catalog` rows this case touches, which is what
`POST /api/cases` uses to check the client is actually allowed to submit
that specific service (`isEnabled` check, ~[route.ts:270](src/app/api/cases/route.ts#L270)).
**If `caseType`/`caseType1` is left blank, `getRequiredServiceSelections`
returns an empty array**, so that check trivially passes (nothing to
validate) — meaning a case can now be created with **no service
selection at all**, and:
- Per-tooth/per-arch invoicing in [invoice.ts](src/lib/invoice.ts) groups
  line items by `(category, subCategory)`
  ([invoice.ts:227-233](src/lib/invoice.ts#L227-L233)) — a case with no
  `subCategory` either won't be grouped/billed at all, or will need a
  fallback bucket (e.g. `"Unspecified"`) added everywhere a `subCategory`
  is read for pricing (`mapCaseToPricingInput`, `getUnitPrice`, the
  case-sheet CSV/PDF export routes for both admin and client).
- `calculateCasePrice()` in [pricing.ts](src/lib/pricing.ts) does
  `CB_PRICE[input.subCategory] ?? 0` etc. — already defensively returns
  `0` for an unknown key, so it won't crash, but it means **the case is
  silently priced at $0** until an admin or account manager fills in the
  missing sub-type after the fact.

This is a real, user-facing billing gap, not just a code-style concern —
worth deciding explicitly rather than me picking silently.

---

## Risks / open decisions — please confirm before I implement

1. **3D Model teeth requirement.** Today teeth are only required for 3D
   Model when Die = Yes. This plan drops that carve-out so teeth are
   always required, matching every other category. If a 3D Model case
   genuinely has no tooth-specific data (e.g. a full-arch model with no
   die), this would now block submission. Confirm you want the
   unconditional rule, or want to keep 3D Model's existing conditional
   rule as the one exception.

2. **Unpriced/no-subcategory cases.** Making `caseType`/`caseType1`
   optional means a case can reach `in_progress` with **zero** service
   selection, which as described above bills at $0 until manually
   corrected on the invoice/admin side. Options, pick one:
   - (a) Accept as-is — design/admin fixes it later, billing team is
     told to watch for `$0` line items.
   - (b) Still require the *primary* selector (`caseType`/`caseType1`)
     server-side even though the UI no longer blocks on it, i.e. treat
     "Category + File + Teeth" as the **UI-visible** requirement bar but
     keep the primary sub-type mandatory underneath — this contradicts
     "only File, category and tooth number required" as literally
     stated, so I'm not defaulting to this without you saying so.
   - (c) Add an explicit "Unspecified" bucket everywhere pricing/
     invoicing reads `subCategory`, and surface a persistent "Missing
     service type — case unbilled" flag on the case detail/admin list
     views so it isn't silently lost.
   My default, absent your input: **(a)**, since it's the literal ask and
   the least code — but I want you to actively choose this rather than
   discover it later on an invoice.

3. **Reference-image UI in bulk-upload flows.** The client and ops pages
   each have a *bulk* mode (drop up to 10 files → one case per file) in
   addition to the single-case form. Adding a 5-image reference picker
   *per row* in bulk mode is more UI work for comparatively rare use
   (bulk submitters are usually optimizing for speed). Proposal: ship
   reference images on the **single-case forms first** (AddCaseDialog,
   client single-submit, ops single-submit); leave bulk rows without it
   in this pass unless you want it everywhere from the start.

4. **Editing reference images after creation.** Should reference images
   be addable/removable after the case is created (like preview files
   are, via their own `POST`/`DELETE` endpoints), or are they locked in
   at creation time only? Preview files use the general edit permission
   pattern (`EDITABLE_STATUSES` type roles). Plan above sketches a
   `POST`/`DELETE` on `[id]/reference-files` for parity, but only build
   it if you want post-creation editing — otherwise `GET`-only (read
   after creation) is a smaller surface.

---

## Suggested implementation order

1. Migration + schema (`case_reference_files`) — foundational, no
   behavior change on its own.
2. `modelRequired` enforcement (#1) — self-contained, no external
   dependencies, lowest risk.
3. Reference images (#2) — additive, doesn't touch existing validation.
4. Relaxed required-fields (#3) — last, since it's the one with the
   billing-side risk that needs your decision first (see Risks #2), and
   touches the most call sites (3 forms + 3Shape + server).

Each can ship as an independent PR/commit if you'd rather review them
separately.
