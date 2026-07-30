# Client Design Preference Form — Implementation Plan

Status: **DRAFT — awaiting approval, no code changed yet.**

## 1. What exists today

### Data model

`src/db/schema/preference-form.ts` — one table, `preference_forms`:
`id, client_id (FK → profiles), form_name, payload (jsonb), created_by, created_at, updated_at`.
A client can have **many** named forms (no uniqueness constraint). The whole
field set lives in the untyped `payload` jsonb column, shaped by
`PreferenceFormPayload` in `src/lib/preference-forms.ts`.

### Current payload fields (`src/lib/preference-forms.ts`)

| Payload key                         | Shape                                                               | Maps to PDF field                               |
| ----------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `occlusion`                         | `{defaultValues, comments}`                                         | #1 Occlusion                                    |
| `proximalContacts`                  | `{defaultValues, comments}`                                         | #2 Proximal Contacts                            |
| `distalMostCrownContact`            | `{defaultValues, comments}`                                         | #3 Contact for Distal-most Crown                |
| `anatomy`                           | `{option: Primary Only/Secondary/Match Adjacent, comments}`         | #4 Anatomy                                      |
| `smileLibrary`                      | `{option: Posterior/Anterior, libraryName, comments}`               | #5 Smile Library — **shape mismatch, see §3.1** |
| `ponticType`                        | `{option: Ovate/Modified Ovate/Modified Ridge Lap/Other, comments}` | #6 Pontic Type                                  |
| `ponticDistanceFromTissue`          | `{option: Flush/Off/Into, distanceMm, comments}`                    | #7 Pontic Distance from Tissue                  |
| `matchMarginalRidge`                | `{option: Yes/No, comments}`                                        | #8 Match Marginal Ridge                         |
| `posteriorCutback`                  | `{option, comments}`                                                | #9 Posterior Cutback                            |
| `anteriorCutback`                   | `{option, comments}`                                                | #10 Anterior Cutback                            |
| `copingPonticDistanceFromTissue`    | `{option: Flush/Off/Into, distanceMm, comments}`                    | #11 Pontic Distance from Tissue (Coping)        |
| `copingCollarType`                  | `{option: No Collar/Lingual Collar/360 Collar, comments}`           | #12 Collar Type                                 |
| `copingCreateIsland`                | `{option: Yes/No, comments}`                                        | #13 Create Island                               |
| `preferredSoftware`                 | `{option: 3 Shape/Exocad}`                                          | not in PDF table (existing extra field — kept)  |
| `uploadedImage1` / `uploadedImage2` | `{fileUrl, fileName} \| null`                                       | not in PDF table (existing extra field — kept)  |

**Every default is currently the empty string** — `createPreferenceFormDefaults()`
does not encode any of the PDF's documented defaults yet.

### UI

- `src/app/client/(dashboard)/preferences/page.tsx` — client-facing page. Lists
  saved forms as summary cards (being converted to a table — see §3.6b),
  plus a create/edit form, currently 4 steps (being expanded to 5 — see §3.5):
  - Step 1 "Full Contour Form": fields #1–#8
  - Step 2 "Facial Cutback": fields #9–#10
  - Step 3 "Coping": fields #11–#13
  - Step 4 "Finally": preferred software + 2 image uploads
- `src/app/admin/(dashboard)/clients/[id]/page.tsx` — read-only list of one
  client's forms (`PrefFormCard`), fetched via `?clientId=`.
- `src/app/admin/(dashboard)/cases/page.tsx` — same read-only card rendering
  inside a case's "Lab preferences" tab (`PreferenceFormCard`).
- **No global admin table exists** — admin can currently only view forms
  scoped to one client at a time. This is a new page.

### API (`src/app/api/preference-forms/`)

- `GET /api/preference-forms?clientId=` — list (subuser resolves to parent
  client; admin can pass any `clientId`).
- `POST /api/preference-forms` — create.
- `PATCH /api/preference-forms/[id]`, `DELETE /api/preference-forms/[id]`.
- No auto-generation on client approval/first-load today.

### Activity log

`preference_form.created/updated/deleted` labels already exist in
`src/lib/activity-log.ts` — no changes needed there.

## 2. What the PDF spec adds that doesn't exist yet

Genuinely new fields (no existing payload key at all):

- **Header**: Lab Name, Contact, Phone (table lists "Phone" twice — treated as
  one field for a single phone number unless you tell me otherwise).
- **#14 Gingiva Levels** — 6 numeric inputs: Anterior × {Buccal, Lingual,
  Mesial & Distal}, Posterior × {Buccal, Lingual, Mesial & Distal}. Defaults:
  Buccal 1.0mm, Lingual 0.5mm, Mesial & Distal 0.5mm (same defaults for both
  arches per the note).
- **#15 Distance to Antagonist** — Radio, default "2.0–2.5 mm". PDF doesn't
  enumerate the other radio options.
- **#16 Identification Dots** — Yes/No, no default.
- **#17 Internal Retention Groove** — Yes/No, no default.
- **#18 Taper Angle** — Radio, default "3°". PDF doesn't enumerate other options.
- **#19 Emergence Profile** — Radio, default "Concave". PDF doesn't enumerate
  other options.
- **#20 Screw-retained Crown** — Radio, default "Hole Size – 2.5 mm". PDF
  doesn't enumerate other options.
- **DME file note** — "Please send DME files for Material Settings /
  Manufacturing Settings" — unclear if this means two new file-upload fields
  or just instructional text near the existing image uploads.

Existing fields that need their **real default value** wired in (currently
all blank): Occlusion (0.4), Proximal Contacts (0.02), Anatomy (Match
Adjacent), Pontic Type (Modified Ridge Lap), Pontic Distance from Tissue
(Into, 0.15mm), Match Marginal Ridge (Yes), Posterior Cutback (Buccal Surface
Only), Anterior Cutback (With Mamelons).

New product behavior requested:

- **Auto-generate a system-default preference form per client.**
- **Admin-facing table of all saved preference forms** (currently only a
  per-client card list exists).

## 3. Open questions before I start building

These affect the data shape and I'd rather confirm than guess and redo:

### 3.1 Smile Library shape mismatch

The PDF has **two independent fields**: "Smile Library (Posterior)" — radio
CAP / Lab Preference, default CAP — and "Smile Library (Anterior)" — radio
Glidewell / Lab Preference, default Glidewell. The existing code instead has
**one field** whose radio options are "Posterior" / "Anterior" (i.e. it
models the arch as the choice, not CAP-vs-Glidewell). Since you asked me not
to remove anything, my plan is: **keep the existing `smileLibrary` field
exactly as-is** (so old saved forms still render), and **add two new fields**
`smileLibraryPosterior {option: CAP/Lab Preference}` and
`smileLibraryAnterior {option: Glidewell/Lab Preference}` that match the PDF.
The form UI would show the new pair; the old field stays in the type/schema
for backward compatibility but drops out of the active form. — **OK to
proceed this way?**

### 3.2 Header fields (Lab Name, Contact, Phone)

Should these be **read-only, pulled from the client's existing profile**
(`profiles.labName`, `fullName`, `phone`) and just displayed at the top of
the form, or **new editable payload fields** (so a client can set a different
contact for design purposes than their account contact)? I'd lean read-only
pulled-from-profile (simplest, always in sync) — confirm?

### 3.3 Missing radio option lists (fields #15, #18, #19, #20)

The PDF only gives me the _default_ value for these, not the full choice
list. I need the actual option sets to build proper radio groups. My
placeholder proposal (please correct):

- Distance to Antagonist: `1.0–1.5 mm / 1.5–2.0 mm / 2.0–2.5 mm / Lab Preference`
- Taper Angle: `0° / 3° / 6° / Lab Preference`
- Emergence Profile: `Concave / Straight / Convex / Lab Preference`
- Screw-retained Crown hole size: `2.0 mm / 2.5 mm / 3.0 mm / Lab Preference`

### 3.4 DME file note

Add two explicit file-upload fields ("Material Settings DME file",
"Manufacturing Settings DME file"), or keep it as instructional text next to
the existing generic image uploads?

### 3.5 Step placement for new fields #14–#20 — DECIDED

Confirmed: the form becomes **5 steps**:

- Step 1 "Full Contour Form": #1–#8 (unchanged)
- Step 2 "Facial Cutback": #9–#10 (unchanged)
- Step 3 "Coping": #11–#13 (unchanged)
- **Step 4 "Implant Abutment" (new)**: #14–#20 (Gingiva Levels, Distance to
  Antagonist, Identification Dots, Internal Retention Groove, Taper Angle,
  Emergence Profile, Screw-retained Crown)
- **Step 5 "Image / File Uploading" (renamed from "Finally")**: preferred
  software + the 2 existing image uploads + (pending §3.4) any new DME
  file uploads.

### 3.6 System auto-generated default form — DECIDED

Confirmed: when a client's account is **approved**
(`/api/admin/clients/approve`), a default preference form is created and
added to their profile automatically. Plus a defensive fallback inside
`GET /api/preference-forms` that lazily creates one for any already-active
client who somehow has zero forms (covers existing clients approved before
this change ships). Fixed `formName = "Default Preferences"`. It's a normal
row seeded with real defaults instead of blanks — client can edit/delete it
like any other form, no locked flag.

### 3.6b Client page layout — DECIDED

Confirmed layout for `src/app/client/(dashboard)/preferences/page.tsx`:
top section becomes a **table** of all the client's saved preference forms
(replacing the current card-grid), and below it the existing step-by-step
add/edit form stays as-is (now 5 steps per §3.5). Proposed table columns:
Form Name, Occlusion, Anatomy, Pontic Type, Created, Updated, Actions
(Edit/Delete) — same underlying data as today's cards, just presented as
rows. Confirm columns, or want different ones?

### 3.7 New admin table page

Proposed: `src/app/admin/(dashboard)/preferences/page.tsx`, route
`/admin/preferences`, new sidebar entry in `AdminSidebar.tsx`. Table columns:
Client, Form Name, Occlusion, Anatomy, Pontic Type, Created, Updated, and a
row action to open the full form read-only (reuse `PreferenceFormCard`-style
detail) — sourced from a new `GET /api/admin/preference-forms` (all clients,
admin-only) rather than the existing client-scoped endpoint. Confirm route
name/placement.

## 4. Implementation checklist (once approved)

1. `src/lib/preference-forms.ts`
   - Add new payload keys: `smileLibraryPosterior`, `smileLibraryAnterior`,
     `gingivaLevels` (anterior/posterior × buccal/lingual/mesialDistal),
     `distanceToAntagonist`, `identificationDots`, `internalRetentionGroove`,
     `taperAngle`, `emergenceProfile`, `screwRetainedCrown`, and (pending 3.4)
     DME file fields.
   - Add matching option-const arrays for the new radio fields.
   - Update `createPreferenceFormDefaults()` to the PDF's real defaults
     (existing fields) and the new fields' defaults.
   - Update `clonePreferenceFormPayload()` to merge all new keys (kept
     additive — nothing existing removed).
   - Add `createSystemDefaultPreferenceForm(clientId, createdBy)` helper.
2. `src/db/schema/preference-form.ts` — no column changes needed (jsonb
   payload absorbs new keys); consider adding an `isSystemDefault` boolean
   column only if 3.6 answer requires distinguishing it beyond the fixed name.
3. Auto-generation wiring:
   - `src/app/api/admin/clients/approve/route.ts` — call the helper after a
     client is approved, so the default form lands on their profile
     immediately.
   - `src/app/api/preference-forms/route.ts` GET — lazy-create fallback for
     existing already-active clients with zero forms.
4. Client UI (`src/app/client/(dashboard)/preferences/page.tsx`):
   - Replace the saved-forms card grid with a table (§3.6b) at the top of
     the page.
   - Add header display (pending §3.2), expand to 5 steps per §3.5 (new
     Step 4 "Implant Abutment" for fields #14–#20; Step 5 renamed
     "Image / File Uploading", carries forward preferred software + uploads)
     in the "add a new form" section below the table.
   - `formStep` type widens from `1 | 2 | 3 | 4` to `1 | 2 | 3 | 4 | 5`.
   - Nothing existing removed or restructured beyond the additive Smile
     Library fields in §3.1.
5. New admin page + API per §3.7, plus `AdminSidebar.tsx` nav entry.
6. Update `PrefFormCard` (admin client detail) and `PreferenceFormCard`
   (admin case detail) to also render the new fields, so all three surfaces
   stay in sync.
7. Verify: `tsc --noEmit`, `eslint` on touched files, full `npm run build`,
   and a manual walkthrough of create/edit/view on client + both admin
   surfaces.

---

**Nothing will be implemented until you confirm §3.1–§3.7 (or tell me to use
my proposed defaults).**
