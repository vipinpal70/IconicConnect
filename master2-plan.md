# `master2` Branch Plan — 3Shape XML Import + Case Modifications, on `master`'s DB structure

## 0. What I found before planning this — read first

This is **not** a simple "branch off master and cherry-pick a feature commit"
situation. I checked the actual git history before writing anything below,
because the naive approach (cherry-pick `02dcd21` onto `master`) does not
apply cleanly and would be the wrong fix even if it did.

**`master` and `xml-feature` share a common ancestor
(`6a06cdb`) but have diverged by ~46 commits each.** Concretely:

- There's a branch in this repo called `backup-master-before-reset-6a06cdb`.
  That name is exactly what it says: at some point, `master` was hard-reset
  back to commit `6a06cdb`, discarding a line of work that included an
  end-to-end **Design + Milling** fulfillment feature, milling-centre
  onboarding, and its pricing. Master's own migration
  [`0046_drop_service_catalog_service_type.sql`](src/db/migrations/0046_drop_service_catalog_service_type.sql)
  says so directly in its comment: *"A previously reverted 'Design+Milling'
  pricing feature left a `service_type` column on `service_catalog`... The
  feature was removed from the app code but this column/constraint was never
  rolled back."*
- `xml-feature` descends from the **pre-reset** lineage. It never lost that
  work — instead it kept building on top of it: Design+Milling fulfillment,
  milling-centre onboarding, a "Milling Only" third service flow, per-client
  price-list enable/disable, a "3D Model" case category with per-lab
  restriction, case-hold/cancellation rules, a multi-file preview carousel —
  and, most recently, the 3Shape XML import feature you want.
- `master` moved forward independently after the reset with its own ~18
  commits (client delete/deactivate, preference-form rework, hold-button
  fixes, etc.) — none of which touch the milling/3D-Model/service-flow
  territory.

**Net effect on the DB schema** (verified directly, not inferred):

| | `master` | `xml-feature` |
|---|---|---|
| `cases.service_type` column | ❌ doesn't exist | ✅ `design_only`/`design_milling`/`milling_only` |
| Milling case statuses (`ready_for_milling`, `dispatched`, …) | ❌ | ✅ |
| `case_preview_files` table | ❌ | ✅ |
| `profiles.model_only_lab`, `profiles.enabled_service_types` | ❌ | ✅ |
| `client_price_list.is_enabled` | ❌ | ✅ |
| `src/lib/case-hierarchy.ts` (shared category/sub-type source) | ❌ doesn't exist — 3 separately-drifted inline copies instead | ✅ |
| `src/lib/case-duplicate.ts`, `src/lib/three-shape/*`, 3Shape UI | ❌ | ✅ |
| Category taxonomy | `"Crown & Bridges"`, `"Denture"`, `"Implant"` (singular/plural differs), **no 3D Model** | `"Crown & Bridge"`, `"Dentures"`, `"Implants"`, **+ 3D Model** |
| Migrations | 46 total, last one is `0046_drop_service_catalog_service_type` | 51 total — **its own, different `0046`** (`0046_milling_schema.sql`) plus five more |

So "port the 3Shape import feature" and "make sure it's on master's DB
structure" are, correctly read, the **same instruction**: don't bring
`xml-feature`'s schema additions over at all (that would silently
reintroduce the Design+Milling/milling-centre feature set that `master`'s
own history shows was deliberately reverted — a product decision, not mine
to make quietly). Instead, **re-target the 3Shape import feature's code at
the schema `master` already has**, adding only what's genuinely new
(nothing, for the import itself — see §4).

The good news, also verified directly: the 3Shape import feature is **more
portable than it first looks**. Its core extraction library
(`src/lib/three-shape/*`) is a dependency-free XML/ZIP parser that only
reads bytes out of R2 and returns a plain draft object — it has **zero
dependency** on `service_type`, price-list enablement, or 3D Model. The one
real coupling point is `src/lib/case-hierarchy.ts`, which only exists on
`xml-feature` and only because that's where the category/option strings
live. `master` has no equivalent single source — each of its 3 case-creation
forms keeps its own inline copy. Every other piece (`case-duplicate.ts`, the
soft-duplicate-skip logic in `POST /api/cases`, `getProfileLabName`) is
either fully self-contained or a small, mechanical adaptation.

---

## 1. Branch setup

```bash
git fetch origin
git checkout -b master2 master   # or origin/master, whichever you want as the base
```

Clean branch, no cherry-picks — the divergence above means a cherry-pick of
`02dcd21` would fail to apply (missing imports: `price-list`,
`case-hierarchy`, `profile-utils`) and, worse, `git checkout --theirs` on
conflicts would silently pull in xml-feature's schema files. Every file
below is **written fresh against `master`'s current content**, not merged.

---

## 2. File-by-file port plan

Legend: **AS-IS** = copy verbatim (self-contained, no divergent dependency).
**ADAPT** = copy, then edit specific lines for `master`'s schema/taxonomy.
**NEW** = doesn't exist on either branch in the form needed; write it for
`master`'s taxonomy. **SKIP** = exists on `xml-feature` but isn't part of
the 3Shape feature itself, or belongs to the reverted milling feature set.

### Extraction library — `src/lib/three-shape/` (14 files)

| File | Action | Why |
|---|---|---|
| `xml.ts`, `zip.ts`, `r2-zip.ts` | **AS-IS** | Pure byte-level XML tokenizer / ZIP reader / R2 range-reader. No app-schema dependency at all. |
| `dental-order.ts` | **AS-IS** | Parses the 3Shape order XML into an internal `ParsedUnit[]` model — 3Shape vocabulary in, not app taxonomy. |
| `assemble.ts`, `model.ts`, `assets.ts`, `raw-scan.ts`, `version.ts` | **AS-IS** | Internal domain model / lossless `ThreeShapeCase` persisted under `subTypeData.threeShape` — just JSON, no schema coupling. |
| `package.ts` | **AS-IS** | Zip/order orchestration (one-order-per-zip rule, error cards). Doesn't touch category taxonomy directly. |
| `taxonomy.ts` | **ADAPT** | Imports `CASE_HIERARCHY` from `case-hierarchy.ts` and maps 3Shape vocabulary → canonical category/option strings. Needs `master`'s strings (§3) instead of `xml-feature`'s. |
| `map-to-case.ts` | **ADAPT** | Emits the category/sub-type-field values `taxonomy.ts` resolves against. No structural change needed — it already treats an unresolved category as `null` and leaves sub-type fields blank+flagged rather than crashing (confirmed by reading it — `setOption()` early-returns `if (candidate == null || !category) return`). Only the taxonomy strings it targets change. See §5 for what happens to "3D Model" detections. |
| `index.ts` | **AS-IS** | Barrel export. |
| `__tests__/*` (6 files) | **AS-IS**, then extend | The unit tests for `xml.ts`/`zip.ts`/`dental-order.ts`/`package.ts` don't depend on app category strings. `taxonomy.test.ts` and any test asserting exact category/option strings need updating to `master`'s taxonomy. |

### Duplicate detection

| File | Action | Why |
|---|---|---|
| `src/lib/case-duplicate.ts` | **AS-IS** | Verified: zero imports, pure functions (`normalizeCaseFileName`, `resolveDuplicates`) operating only on filenames/tooth-number sets. Completely decoupled from schema. |
| `src/lib/__tests__/case-duplicate.test.ts` | **AS-IS** | Same reason. |

### Small supporting utility

| File | Action | Why |
|---|---|---|
| `src/lib/profile-utils.ts` | **AS-IS (new file on master2)** | `getProfileLabName()` — `labName → fullName → email → 'Client'` fallback chain. Doesn't exist on `master` (its routes currently inline `clientProfile?.labName || 'UnknownLab'`). Verified it has no dependency on any milling-era field. Bringing it in is a strict improvement (removes the `'UnknownLab'` magic string) and `xml-extract/route.ts` needs it. |

### Category/sub-type source of truth

| File | Action | Why |
|---|---|---|
| `src/lib/case-hierarchy.ts` | **NEW** | Doesn't exist on `master`. Create it fresh, populated with `master`'s actual taxonomy (§3) — **not** a copy of `xml-feature`'s. Per case-modification-plan.md item 3, every field is written `optional: true` from the start (no follow-up edit needed — see §6). **Drop** `getRequiredServiceSelections`, `buildEnabledKeySet`, `isFieldOptionEnabled`, `isCategoryAvailable`, and the `PricedRow`/`ServiceSelection` types entirely — those exist only to check `client_price_list.isEnabled`, which doesn't exist on `master`. Keep only the `CaseHierarchyField`/`CaseHierarchyCategory` shape and the `CASE_HIERARCHY` map itself, since that's all `taxonomy.ts` and the 3Shape review UI actually need. |

### API routes

| File | Action | Why |
|---|---|---|
| `src/app/api/cases/xml-extract/route.ts` | **ADAPT** | Read-only extraction endpoint. Logic is unchanged; imports adjust: drop nothing else, it doesn't touch price-list/service-type. Uses `getProfileLabName` (now available) and `case-hierarchy.ts` (now available, adapted taxonomy). |
| `src/app/api/cases/route.ts` | **ADAPT — small, isolated diff** | I isolated exactly what commit `02dcd21` changed in this file (as opposed to the accumulated diff, which also includes the *unrelated*, earlier price-list-gating commit `243ad17` that we are **not** porting). The 3Shape-specific diff is self-contained: <br>1. Add `skipIfDuplicate?: boolean` / `forceCreate?: boolean` to the `CasePayload` type.<br>2. Add the soft-duplicate-skip block (`caseFileNames`, `payloadTeeth`, `skipIndices`, `skipped`, using `resolveDuplicates`/`normalizeCaseFileName` from `case-duplicate.ts`) — this slots into `master`'s existing strict-duplicate-409 block with the same shape it has there today, just adding the soft path alongside it.<br>3. `if (skipIndices.has(i)) continue;` at the top of the per-case loop.<br>4. Response becomes `{ data, skipped }` instead of `{ data }` (additive — existing callers reading `.data` are unaffected).<br>Nothing about `serviceType`, price-list, or `modelOnlyLab` is touched, because `master`'s version of this file has none of that to begin with. |
| `src/app/client/(dashboard)/cases/page.tsx` | **ADAPT — trivial** | The 3Shape-specific diff here is 20 lines: add a 3rd "3Shape Import" tab to the existing `Tabs`/`TabsList` in the "Submit New Case" dialog, rendering `<ThreeShapeImport onSubmitted={...} onClose={...} />`. `master`'s file already has the `single`/`bulk` 2-tab structure this diff extends — port it directly, adjusting only line numbers/context. |

### UI components

| File | Action | Why |
|---|---|---|
| `src/components/ThreeShapeImport/ThreeShapeImport.tsx` | **AS-IS**, imports adjust | Imports `CASE_HIERARCHY` from `case-hierarchy.ts` (now exists, adapted) and `uploadFileInChunks` from `upload-utils.ts` (already exists on `master`, unchanged — verified). No other divergent dependency. |
| `src/components/ThreeShapeImport/DraftCaseForm.tsx` | **AS-IS**, imports adjust | Same — renders whatever `CASE_HIERARCHY[category].fields` says, so it automatically reflects `master`'s taxonomy once `case-hierarchy.ts` is adapted. Also gets the `modelRequired`-unset-state fix from case-modification-plan.md §1e directly, since we're writing this file fresh for master2 (see §6). |
| `src/components/ThreeShapeImport/draft-logic.ts` | **AS-IS**, imports adjust | Pure validation helpers (`draftValid`, `highlightFields`, `isForced`, `openWarnings`) over `CASE_HIERARCHY` + draft state. No divergent dependency. Also gets the `modelRequired`-required and teeth-always-required edits from case-modification-plan.md directly (§6). |
| `src/components/ThreeShapeImport/__tests__/draft-logic.test.ts` | **ADAPT** | Update category/option strings in fixtures to `master`'s taxonomy; keep the test structure. |
| `src/components/CaseDetailView.tsx` | **ADAPT — additive only** | The 91-line diff adds a collapsible "Imported from 3Shape" panel keyed off `subTypeData.threeShape` being present. Purely additive JSX + one read of `case.subTypeData.threeShape` — no schema dependency. Port with line-number adjustment; `master`'s `CaseDetailView.tsx` is a different (older) file so this needs a manual re-application, not a clean patch. |

### Config / tooling

| File | Action | Why |
|---|---|---|
| `vitest.config.ts` | **AS-IS (new file)** | 16 lines, no schema dependency. `master`'s `package.json` currently has **no** `test` script and **no** `vitest` dependency at all (verified) — add both (`"test": "vitest run"`, `"test:watch": "vitest"`, `vitest` devDependency) exactly as commit `02dcd21` did. This was the **only** new package the entire feature introduced — the XML/ZIP parsing is hand-rolled, so there's no risk of a version-conflicting third-party dependency. |
| `src/lib/activity-log.ts` | **ADAPT — one line** | Add `if (action === 'case.xml_extracted') return '3Shape packages extracted for review'` to `formatActivityLabel`. `master`'s file already has the `case.created` line this sits next to. |
| `package-lock.json` | **regenerate** | Don't port the diff (it's the accumulated lockfile diff of the whole feature branch's dependency drift, including milling-era packages). Run `npm install` on `master2` after adding `vitest` to `package.json` and let it regenerate cleanly against `master`'s existing dependency set. |
| `scripts/verify-3shape.ts` | **SKIP** | The commit's own message calls this "a throwaway harness — remove before merge." Not needed. |
| `case-architecture-plan.md`, `xml-work-plan.md` | **Optional — bring over as reference docs** | Planning documents, not code. Useful context for whoever reads this later; zero risk either way. Recommend including them, since they explain *why* the extraction library is built the way it is (zip-bomb guards, one-order-per-zip rule, etc.) — genuinely useful for future maintenance. |

### Explicitly excluded (do not port)

- `0046_milling_schema.sql` through `0051_case_preview_files.sql` (all six xml-feature-only migrations) — milling fulfillment, 3D Model category, milling-centre onboarding, preview-file carousel. None of this is "the 3Shape import feature"; it's separate work that happens to live on the same branch. Per your instruction ("only xml-feature/3shape import feature and case modification"), this stays out.
- Commit `538bf78` ("lets check on xml-feature branch") — checked its diff directly: it's a deploy-workflow tweak plus an unrelated admin password-reset script. Not related to 3Shape at all. Skip.
- Commit `a3696f3` (Supabase orphaned-auth-user cleanup) — already present on `master` as `11b5701` with the same content under a different hash (both branches got this fix independently). Nothing to port.
- `service_type`, `modelOnlyLab`, price-list `isEnabled`/`enabledServiceTypes` enforcement anywhere in the ported code.

---

## 3. Taxonomy remapping — `xml-feature` strings → `master` strings

This is what `case-hierarchy.ts` (new) and `taxonomy.ts` (adapted) need to
target. Verified directly against `master`'s three current inline copies
(`AddCaseDialog.tsx`, client cases page, ops cases page):

| | `master` (target) | `xml-feature` (source the 3Shape code currently emits) |
|---|---|---|
| Category key | `"Crown & Bridges"` | `"Crown & Bridge"` |
| Category key | `"Denture"` | `"Dentures"` |
| Category key | `"Implant"` | `"Implants"` |
| Category key | `"Cosmetics"` | `"Cosmetics"` *(unchanged — verify exact option list matches during implementation)* |
| Category key | *(none)* | `"3D Model"` — **no home on `master`.** See §5. |
| Appliances → `caseType1` | `["Night Guards", "Sports Guard", "Mouth Guard", "NTI"]` | `["Night Guards", "Sport Guards", "Mouth Guards", "NTI"]` — note the pluralization swap (`Sports Guard` vs `Sport Guards`, `Mouth Guard` vs `Mouth Guards`) |
| Appliances → `occlusion` | `["even occlusion", "custom"]` (lowercase) | `["Even Occlusion", "Custom"]` |
| Appliances → `arch` | `["Lower", "Upper"]` — **no "Both Arches"** | `["Upper", "Lower", "Both Arches"]` |
| Denture → `caseType2` (Arch) | `["Lower", "Upper", "Both Arches"]` | same set, different order (`["Upper", "Lower", "Both Arches"]`) |
| Implant fields | `caseType1` (label "Sub Type 1"): `["Robotic","Custom","Ti-Base"]`; `caseType2` optional `["None","Crown","Bridge"]` | Same options, label "Sub Type"/"Crown & Bridge type" |

**Practical consequence for `map-to-case.ts`/`taxonomy.ts`:** a scan that
would have inferred `arch: "Both Arches"` for an **Appliance** case on
`xml-feature` has no matching option under `master`'s Appliances hierarchy.
The existing unmapped-option path already handles this safely — `setOption()`
pushes a `SUBTYPE_UNMAPPED` warning and leaves the field blank rather than
guessing, which is exactly the fallback we want here; no new code needed,
just confirming the alias table in `taxonomy.ts` doesn't try to force a
match. Same applies to the Appliances `caseType1` pluralization differences
— add both spellings to `taxonomy.ts`'s `OPTION_ALIASES` table so a
plausible extraction resolves to `master`'s actual string instead of
falling through to "unmapped."

Crown & Bridge and Cosmetics option lists look identical between branches
from what I read, but I have not byte-for-byte diffed every option string —
**verify these two during implementation** rather than assume; low risk
either way since a mismatch just produces an "unmapped, left blank" warning
rather than a wrong value.

---

## 4. Database migrations for `master2`

**Zero new migrations for the 3Shape import feature itself.** Verified: the
entire feature stores its data in `cases.sub_type_data` (existing `jsonb`
column) under a new `threeShape` key — no new table, no new column, nothing
`master`'s current schema doesn't already have. This is exactly what "db
from master branch as main db structure" should mean in practice: the
feature slots into the existing shape without asking for anything new.

**One new migration, for the case-modification work (§6.2 below):**

```
src/db/migrations/0047_case_reference_files.sql
```

Numbered `0047` — continuing `master`'s own sequence directly after its
`0046_drop_service_catalog_service_type.sql`, **not** `0052` (which is what
it would be if numbered after `xml-feature`'s last migration — that
numbering doesn't apply here since none of `xml-feature`'s 0046–0051 are
being ported). Content is the `case_reference_files` table from
case-modification-plan.md §2, generated the normal way (`npm run
db:generate` after adding the Drizzle table definition, then `npm run
db:migrate` to apply).

---

## 5. Open decision — 3Shape scans that would map to "3D Model"

`map-to-case.ts`'s category inference (`pickCategory`) falls back to
`'3D Model'` when nothing else matches (implant/crown/bridge/veneer/wax-up
keywords all miss — i.e. a mesh-only or model-only scan). On `xml-feature`
that's a real, orderable category. On `master`, once `case-hierarchy.ts` is
adapted to drop the `'3D Model'` key, `normalizeAppCategory()` — which
already does `if (mapped && CASE_HIERARCHY[mapped]) return mapped`, else
`null` — returns `null` for these automatically, no extra code required.

Verified this degrades safely rather than crashing: `map-to-case.ts`'s
`setOption()` helper already no-ops when `category` is `null`
(`if (candidate == null || !category) return`), so the draft comes back
with `category: null`, teeth still computed where derivable, and every
sub-type field left blank. The existing review-carousel UI already treats a
missing category as "needs review" (that's what `requiresReview` is for) —
the lab picks a real category manually before submitting, same UX as any
other package the parser can't fully read.

**What I'm not deciding for you:** whether that's the right *product*
behavior, or whether `master2` should instead get some minimal "Model"
category as a fourth Appliances-like option so these scans have a proper
home. Flagging it — my default is "leave it as manual-review, ship it,"
since re-adding a 3D Model category is exactly the kind of schema
expansion this plan is trying to avoid pulling in silently.

---

## 6. Layering the case-modification-plan.md changes onto `master2`

All three items from `case-modification-plan.md` apply to `master2`
**cleanly, and in some places more simply than on `xml-feature`**, because
several of the complications noted there were caused by the very
service-type/3D-Model infrastructure this branch doesn't have.

### 6.1 `modelRequired` forced choice

Applies exactly as planned — it's pure `subTypeData` JSON, untouched by the
schema divergence. One simplification: the server-side guard in
`POST /api/cases` doesn't need a `category !== '3D Model'` exemption on
`master2`, since there is no 3D Model category to exempt:

```ts
const mr = (caseData.subTypeData as { modelRequired?: unknown } | undefined)?.modelRequired;
if (mr !== 'yes' && mr !== 'no') {
  return NextResponse.json(
    { error: 'Please specify whether a model is required for this case.' },
    { status: 400 }
  );
}
```
unconditionally, for every case. Applies to all 4 forms (`AddCaseDialog`,
client single/bulk, ops single/bulk) exactly as described there, plus
`DraftCaseForm.tsx`/`draft-logic.ts`/`map-to-case.ts` — which, since we're
writing those three files fresh for `master2` in §2 above, get the
unset-by-default fix built in from the start rather than as a follow-up
edit.

### 6.2 Reference images (≤5, optional)

Applies exactly as planned: new `case_reference_files` table (§4 above,
migration `0047`), reusing `master`'s existing
`src/app/api/cases/upload/route.ts` R2 multipart flow as-is (verified this
file and `src/lib/upload-utils.ts` both already exist on `master`,
unchanged from what was read earlier — no adaptation needed there). Add
`caseReferenceFiles` to `master`'s
`src/lib/queue/r2-cleanup-task.ts` — verified its current query set on
`master` is `[caseFiles, cases, chatMessages]` (it never had
`casePreviewFiles` to begin with, since that table doesn't exist on
`master` either), so this is a clean one-line addition to that
`Promise.all`, not a merge against a divergent version.

### 6.3 Only File + Category + Tooth Number required

This is where the fresh `case-hierarchy.ts` (§2) pays off: instead of
porting a file with every field required and then editing it to add
`optional: true` everywhere (the two-step process case-modification-plan.md
describes for `xml-feature`), **`master2`'s `case-hierarchy.ts` is written
with every field `optional: true` from its first commit.** The teeth-always-
required rule (dropping the 3D-Model carve-out) needs no special case either
— there's no 3D Model category on `master2` for the carve-out to apply to,
so `teeth.length > 0` is simply the rule, everywhere, from the start.

One real decision this raises that case-modification-plan.md flagged for
`xml-feature` too, and which still applies here: **`master`'s own
`POST /api/cases` has no server-side field validation at all today** (no
category/file/teeth checks — confirmed by reading it directly). Adding the
three guards from case-modification-plan.md §3 is new server-side
enforcement on `master2`, not a relaxation of something that already
existed there.

Additional decision specific to `master2`, not present in the original
plan: `master` currently has **three independently-drifted inline copies**
of its category hierarchy (`AddCaseDialog.tsx`, client cases page, ops
cases page) — the same duplication `xml-feature`'s `case-hierarchy.ts` was
built to eliminate (per that file's own header comment). Since `master2`
needs a shared `case-hierarchy.ts` anyway for the 3Shape review UI to
consume, you get a choice for free:

- **(a) Minimal-diff:** add `case-hierarchy.ts` only for the 3Shape-import
  code path: leave `AddCaseDialog.tsx` / client page / ops page each with
  their own inline copy, and apply the "every field optional" + "teeth
  always required" edit to all three copies independently. Matches
  case-modification-plan.md's original scope exactly.
- **(b) Consolidate:** migrate all three forms to import from the new
  shared `case-hierarchy.ts` too, deleting the three inline copies (this is
  literally what `xml-feature` did in its own history). One source of
  truth, no future drift between the 3Shape-imported drafts and the manual
  forms. Bigger diff, touches more files, but is the more correct fix and
  avoids the exact bug class (`"Crown & Bridges"` vs `"Crown & Bridge"`
  drift) documented in §3 above.

I'd lean **(b)** given we're already introducing the shared file and it
removes a real, demonstrated drift risk — but it's a larger change than
what you asked for verbatim, so flagging it as a choice rather than
defaulting silently. **(a)** is the safe, literal-scope option.

---

## 7. Suggested implementation order

1. `git checkout -b master2 master`.
2. Add `case-hierarchy.ts` (new, `master`-taxonomy, all fields optional per
   §6.3) and `profile-utils.ts` (new, as-is).
3. Port the `src/lib/three-shape/` library (AS-IS files first, then
   `taxonomy.ts`/`map-to-case.ts` adapted per §3) with its test suite.
   Run `npm run test` in isolation before wiring up routes/UI — the parser
   tests don't need the DB or R2.
4. Port `case-duplicate.ts` + its test.
5. Add `vitest.config.ts`, `test`/`test:watch` scripts + `vitest`
   devDependency to `package.json`, `npm install` to regenerate the
   lockfile cleanly against `master`'s existing deps.
6. Adapt `src/app/api/cases/xml-extract/route.ts` and the isolated
   `src/app/api/cases/route.ts` diff (§2).
7. Port `ThreeShapeImport.tsx`, `DraftCaseForm.tsx`, `draft-logic.ts` (with
   the case-modification `modelRequired`/teeth fixes built in), wire the
   3rd tab into the client cases page, add the `CaseDetailView.tsx` panel.
8. `npm run build && npx tsc --noEmit && npm run lint && npm run test` —
   same verification bar the original commit message records.
9. Layer the remaining case-modification changes not already folded into
   step 2–7: reference-images migration + upload UI + R2-cleanup update
   (§6.2), and — if you pick option (b) in §6.3 — the 3-form consolidation
   onto `case-hierarchy.ts`.
10. Manual smoke test against a couple of real 3Shape zips from
    `case_data/` (same packages the original feature verified against),
    checking specifically that Appliances/Denture arch and occlusion values
    map to `master`'s actual option strings, not silently blank.

Each step is independently testable/committable — I'd recommend committing
in roughly this order rather than one giant commit, so a taxonomy mistake
in step 3 doesn't block reviewing step 7's UI work.
