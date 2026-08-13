# 3D Model Case Category — Implementation Plan

Covers both `master` and `phase2`. Shared design in the first half; branch-specific
file/line references at the end. Written from the current state of both branches as of
this session — re-check line numbers before editing, code may have moved.

## 1. Feature summary

1. **New case category "3D Model"**, selectable in case creation, with its own fields:
   - **Case Type** (`caseType1`): `Full Arch Model | Quad Model | Contact Model | Horse Shoe Model | Implant Model`
   - **Model Type** (`caseType2`): `Hollow | Solid`
   - **Die**: `Yes/No` → **+$0.50 per tooth selected** when Yes (reveals a "Die Selection"
     tooth chart, mandatory only in this case — see §8, §11)
   - **Articulator**: `Yes/No` → **+$0.50 flat** when Yes — no tooth selection involved
   - **Drain Holes**: `Yes/No` → **+$0.00 flat** when Yes (seeded default, admin-editable
     via Service Catalog UI, see §4)
2. **This is a distinct pricing line from the existing "Model Required?" toggle.** The
   existing `modelRequired` yes/no flag (billed via catalog row `category='Model',
subCategory='3D Model'`, currently $4.00/case) is used today as an add-on on _other_
   categories (Crown & Bridge, Denture, etc.) and **must not change** — same catalog row,
   same default price, same invoice/billing behavior. The new "3D Model" category is
   billed through **brand-new, separate catalog rows** (category `'3D Model'`), so the two
   systems never share a price or a code path beyond structural pattern-matching.
3. **Lab restriction**: admin can flag a client/lab profile as "3D Model only." When set,
   that lab's case-creation UI and the `POST /api/cases` API only accept category
   `"3D Model"` — every other category is hidden/rejected for that lab. Labs without the
   flag are unaffected and keep full category access.

## 2. Why this shape (design notes)

- **New top-level category, not a modifier.** The 5 case types + Hollow/Solid + 3 add-ons
  map exactly onto the existing `CASE_HIERARCHY` pattern already used for every other
  category (`Denture`, `Appliance`, `Implant`, …): a list of `{ name, label, type: "select",
options }` fields rendered by the existing generic field-loop. Die/Articulator/Drain
  Holes are modeled as `select` fields with `["Yes","No"]` options — same mechanism as
  every other dropdown, not new UI components, avoiding a bespoke "boolean field" type.
- **Pricing reuses the existing catalog + per-client override architecture**
  (`service_catalog` / `client_price_list`), just with new rows. No schema redesign
  needed — `unitType: 'per_case'` already exists (used today by the `Model/3D Model` row).
  Die/Articulator/Drain Holes become their own `per_case` catalog rows under category
  `'3D Model'`, priced independently and summed onto the case, mirroring exactly how
  Implant cases already split into an implant-device line + an optional Crown/Bridge line
  in `buildInvoiceItems`.
- **The "Model Required?" toggle is suppressed for category = "3D Model."** Since the new
  category _is_ a model, showing "Model Required?" on top of it would double up on an
  unrelated $4.00 charge and confuse the case data. The form must hide that control (and
  never submit `modelRequired: "yes"`) when category is "3D Model"; pricing code must
  never apply the old Model add-on to a `'3D Model'`-category case.
- **Pricing logic is duplicated across ~5 files today** (pre-existing architecture, not
  introduced by this feature) — every one of them independently pattern-matches on
  `case.category` and needs a parallel new branch for `'3D Model'`:
  1. `src/lib/pricing.ts` — `mapCaseToPricingInput()` (feeds `buildInvoiceItems`) and the
     legacy `calculateCasePrice()` (feeds the old `/api/billing` overview).
  2. `src/lib/invoice.ts` — `buildInvoiceItems()` (the real invoice-generation pricing
     engine); also needs a case for `'3D Model'` alongside its existing Implant special-case
     and Model-add-on block.
  3. `src/app/api/billing/clients/[clientId]/route.ts` — local `computeCasePrice()`.
  4. `src/app/api/admin/invoices/[id]/case-sheet/route.ts` — local per-line pricing.
  5. `src/app/api/client/invoices/[id]/case-sheet/route.ts` — local per-line pricing
     (client-facing mirror of #4).
     This plan touches all five identically on each branch. Consider consolidating this into
     one shared pricing function as a follow-up — **out of scope here**, don't do it as part
     of this change (keep the diff mechanical and consistent with existing duplication rather
     than triggering an unrelated refactor).
- **Case-creation form logic is duplicated across 3 files** on each branch (also
  pre-existing, not introduced here):
  - `src/components/AddCaseDialog.tsx` (admin "Add Case" modal, also used for client role
    via its `role` prop)
  - `src/app/client/(dashboard)/cases/page.tsx` (client portal's own full case-creation
    UI, including bulk upload — does **not** import `AddCaseDialog`, has its own copy of
    `CASE_HIERARCHY` and `modelRequired` state)
  - `src/app/(ops)/cases/page.tsx` (ops/admin case list page — also has its own copy of
    `CASE_HIERARCHY`)
    All three need the same `CASE_HIERARCHY["3D Model"]` entry, the same "hide Model
    Required? for this category" tweak, and the same lab-restriction gating.

## 3. New database field: lab restriction

Add to `profiles` table (`src/db/schema/profile.ts`) on **both branches**, same shape:

```ts
modelOnlyLab: boolean('model_only_lab').default(false).notNull(),
```

- Run `drizzle-kit generate` to produce the migration SQL on each branch separately (their
  migration histories have diverged, so this cannot be one shared migration file).
- Reuse the existing `PATCH src/app/api/admin/clients/[id]/route.ts` handler (currently
  only accepts `{ status }`, sets it at line ~96) — extend it to also accept and persist
  `modelOnlyLab: boolean` from the request body. Don't add a new dedicated route; this
  one already does authenticated admin-only profile patching.
- Enforcement points (both branches):
  - `POST /api/cases` (`src/app/api/cases/route.ts`) — after resolving `clientId`, load
    that client's `profiles.modelOnlyLab`. If `true`, reject (400) any case in the batch
    whose `category !== "3D Model"`.
  - Case-creation UI (all 3 files from §2) — when the acting client's profile has
    `modelOnlyLab: true`, filter the Category `<Select>` to only render `"3D Model"` and
    default `category` state to `"3D Model"` instead of `"Crown & Bridge"`. Fetch the flag
    the same way each page already fetches the caller's profile/role.
  - Admin UI toggle — add a checkbox/switch in `src/app/admin/(dashboard)/clients/[id]/page.tsx`
    next to the existing client-editable fields, calling the extended PATCH endpoint above.

## 4. Pricing catalog — new rows

Add to the catalog seed (**do not touch the existing `Model`/`3D Model` row** —
`{ category: 'Model', subCategory: '3D Model', ... defaultPrice: '4.00' }` stays exactly
as-is):

| category   | subCategory        | unitType   | defaultPrice |
| ---------- | ------------------ | ---------- | ------------ |
| `3D Model` | `Full Arch Model`  | `per_case` | `3.50`       |
| `3D Model` | `Quad Model`       | `per_case` | `3.50`       |
| `3D Model` | `Contact Model`    | `per_case` | `3.50`       |
| `3D Model` | `Horse Shoe Model` | `per_case` | `3.50`       |
| `3D Model` | `Implant Model`    | `per_case` | `3.50`       |
| `3D Model` | `Die`              | `per_case` | `0.50`       |
| `3D Model` | `Articulator`      | `per_case` | `0.50`       |
| `3D Model` | `Drain Holes`      | `per_case` | `0.00`       |

All 8 rows are ordinary `service_catalog` rows, so the admin already gets price editing
for free through the existing Service Catalog admin UI (same screen used for the other 23
rows today) — no extra "admin sets price" work needed beyond seeding these defaults;
that UI already supports editing `defaultPrice` per row and per-client overrides via
`client_price_list`.

**Resolved:**

- Base per-case price for the 5 case types: **$3.50** each.
- Drain Holes: **$0.00** default, editable by admin like every other catalog row (no
  special-casing needed — the generic Service Catalog editor already covers this).
- Naming overlap between the new `category: '3D Model'` catalog rows and the
  pre-existing `category: 'Model', subCategory: '3D Model'` row: **kept as originally
  designed** — the pre-existing row stays exactly what it is today, an add-on billed
  under whichever _other_ main category the case belongs to (Crown & Bridge, Denture,
  etc.) via the `modelRequired` flag. It is not touched, merged, or renamed; the two
  systems simply coexist under similar-looking names. No code change required beyond
  what §2/§7 already specify (never let a `'3D Model'`-category case trigger the old
  `modelRequired` add-on, and vice versa).
- ~~Whether the tooth/arch `ToothChart` selector should still be required for "3D Model"
  cases~~ — **RESOLVED**: tooth selection is **optional** for "3D Model" cases, but
  becomes **mandatory when Die = Yes** (Die's price depends on teeth count, so it can't be
  priced without a selection). See §8 and §11 for the exact validation rule and UI label
  change.

Both `master`'s `ensureServiceCatalogSeeded()` (23 items today) and `phase2`'s equivalent
(also seeds a `serviceType` column) need the 8 new rows appended with the next
`sortOrder` values. On phase2, set `serviceType: 'design_only'` on all 8 new rows — "3D
Model" is a standalone category, not part of the Design/Milling routing, so it doesn't
need `design_milling`/`milling_only` variants.

## 5. Type extension

`src/types/pricing.ts` — add:

```ts
export type ModelCaseType =
	| "Full Arch Model"
	| "Quad Model"
	| "Contact Model"
	| "Horse Shoe Model"
	| "Implant Model"

	// add to the CasePricingInput union:
	| {
			category: "3D Model";
			subCategory: ModelCaseType;
			die: boolean;
			articulator: boolean;
			drainHoles: boolean;
	  };
```

## 6. Case number prefix

`src/lib/case-utils.ts` (identical on both branches) — add to `CATEGORY_PREFIXES`:

```ts
"3D Model": "3DM",
```

(Confirm `"3DM"` is acceptable — it's the only prefix starting with a digit; the
auto-generated fallback would otherwise produce the same "3DM" from splitting the string,
so this is mostly for clarity/explicitness.)

## 7. Pricing engine changes — the 5 duplicated call sites (§2)

Same shape in each, following the existing "check category, add per-flag surcharges"
pattern already used for Model/modelRequired:

```ts
if (cat === "3d model") {
	const caseType1 = String(data.caseType1 || "Full Arch Model");
	let price = getPrice("3D Model", caseType1, serviceType /* phase2 only */);
	if (data.die === "yes") price += getPrice("3D Model", "Die", serviceType);
	if (data.articulator === "yes")
		price += getPrice("3D Model", "Articulator", serviceType);
	if (data.drainHoles === "yes")
		price += getPrice("3D Model", "Drain Holes", serviceType);
	return parseFloat(price.toFixed(2));
}
```

Do **not** add a `modelRequired` check inside this branch — 3D Model cases never trigger
the old Model add-on (the UI won't even show that toggle for this category, see §2).

Apply to:

1. `src/lib/pricing.ts` → `mapCaseToPricingInput()` add a `'3d model'` branch returning
   `{ category: '3D Model', subCategory: caseType1, die, articulator, drainHoles }`.
   Also extend legacy `calculateCasePrice()` — **confirmed: use base price only**, not the
   full Die/Articulator/Drain Holes formula (that legacy engine has no per-tooth counting
   and this endpoint doesn't need it):

   ```ts
   const MODEL_BASE_PRICE = 3.5 // matches the '3D Model' catalog base default, §4

   // inside calculateCasePrice()'s switch:
   case '3D Model':
     return MODEL_BASE_PRICE
   ```

   This deliberately ignores Die/Articulator/Drain Holes add-ons on the legacy `/api/billing`
   overview — it only ever shows the base case-type price there. If the catalog base price
   is changed later via the admin UI, this hardcoded constant will drift out of sync — same
   pre-existing limitation `ARCH_PRICE`/`CB_PRICE`/`APPLIANCE_PRICES` already have in this
   file (none of them read from the DB either), not a new regression.

2. `src/lib/invoice.ts` → `buildInvoiceItems()`: after the existing Implant special-case
   block, add a `'3D Model'` special-case block that emits up to 4 line items per case
   (base case-type + Die + Articulator + Drain Holes, each only if applicable), mirroring
   the existing Implant device+CB split. Group/key by `serviceType` on phase2 same as
   everything else in that function.
3. `src/app/api/billing/clients/[clientId]/route.ts` → `computeCasePrice()`: add the `cat
=== '3d model'` branch shown above, using the file's existing `getPrice` closure.
4. `src/app/api/admin/invoices/[id]/case-sheet/route.ts` and
   `src/app/api/client/invoices/[id]/case-sheet/route.ts`: both have their own per-case
   line-description builder keyed off `modelRequired`/category — add the equivalent
   branch so the printed case sheet shows correct category/subType/price for 3D Model
   cases instead of falling through to whatever their default/blank case is today.

## 8. Case-creation UI changes (3 files, both branches — §2)

In each of `AddCaseDialog.tsx`, `client/(dashboard)/cases/page.tsx`, `(ops)/cases/page.tsx`:

1. Add to that file's `CASE_HIERARCHY` object:
   ```ts
   "3D Model": {
     fields: [
       { name: "caseType1", label: "Case Type", type: "select",
         options: ["Full Arch Model", "Quad Model", "Contact Model", "Horse Shoe Model", "Implant Model"] },
       { name: "caseType2", label: "Model Type", type: "select", options: ["Hollow", "Solid"] },
       { name: "die", label: "Die", type: "select", options: ["Yes", "No"] },
       { name: "articulator", label: "Articulator", type: "select", options: ["Yes", "No"] },
       { name: "drainHoles", label: "Drain Holes", type: "select", options: ["Yes", "No"] },
     ]
   }
   ```
   This reuses the existing generic field-rendering loop (`AddCaseDialog.tsx` ~line
   822-841) as-is — no new field `type` or component needed.
2. Hide the standalone "Model Required?" `RadioGroup` (`AddCaseDialog.tsx` lines ~642-648
   and ~813-819) when `category === "3D Model"`, and don't include `modelRequired` in the
   submitted payload for this category (or force it to `"no"`).
3. Apply the `modelOnlyLab` category-filtering from §3 to the Category `<Select>` in each
   file (`Object.keys(CASE_HIERARCHY).map(...)`).
4. Tooth selection for "3D Model": **the `ToothChart` section is hidden entirely unless
   Die = Yes**, and its title reads **"Die Selection"** for this category (same underlying
   `teeth` state/field and the same `<ToothChart>` component instance as every other
   category — UI-only, not a new field). This is a conditional-render, not just a relaxed
   validation — mirror the existing pattern already used for Implant's optional
   Crown/Bridge teeth section (`AddCaseDialog.tsx:790-795`, conditioned on
   `subTypeData.caseType2 !== "None"`):
   ```tsx
   {
   	category === "3D Model" && subTypeData.die === "yes" && (
   		<div className="space-y-2">
   			<Label className="text-xs font-semibold text-gray-700">
   				Die Selection (...)
   			</Label>
   			<ToothChart
   				selected={teeth}
   				onChange={setTeeth}
   				system={toothSystem}
   				onChangeSystem={setToothSystem}
   			/>
   		</div>
   	);
   }
   ```
   and skip rendering the generic `ToothChart` block for "3D Model" in the normal
   (non-Implant) branch instead. Submit-validation:
   ```ts
   const teethValid =
   	category === "3D Model"
   		? subTypeData.die !== "yes" || teeth.length > 0
   		: teeth.length > 0;
   ```
   i.e. teeth selection stays required for every other category exactly as today; for "3D
   Model" it's not shown/not required unless `die === "yes"`, in which case the section
   appears and becomes required (error toast, same pattern as the existing `!teethValid`
   check at `AddCaseDialog.tsx:382-385`). Toggling Die back to "No" after teeth were picked
   should clear `teeth` back to `[]`, same as the existing Implant pattern clears
   `crownBridgeTeeth` when `caseType2` resets to `"None"` (`AddCaseDialog.tsx:774-777`).

## 9. Display / detail view

`src/components/CaseDetailView.tsx` already generically renders `subTypeData` key/value
pairs (line ~106 filters out a fixed set of known keys like `teeth`, `modelRequired`).
The new fields (`caseType1`, `caseType2`, `die`, `articulator`, `drainHoles`) will render
automatically through that generic path — verify the labels read sensibly (e.g. "Die: Yes")
without needing new code; only touch this file if the generic rendering looks wrong for
Yes/No fields.

## 10. Rollout checklist

- [ ] Schema migration on both branches (`profiles.model_only_lab`, catalog seed rows)
- [ ] Confirm/replace the 6 placeholder `$0.00` prices in Service Catalog admin UI before
      any lab uses this in production
- [ ] Update `CASE_HIERARCHY` in all 3 case-creation UI files, both branches
- [ ] Hide "Model Required?" for category = "3D Model"
- [ ] Update all 5 pricing call sites, both branches
- [ ] Add `modelOnlyLab` toggle to admin client detail page + extend PATCH endpoint
- [ ] Enforce `modelOnlyLab` server-side in `POST /api/cases` (don't rely on UI-only gating)
- [ ] Manually create one case per case-type/add-on combination and confirm invoice +
      case-sheet totals match expectations, and confirm existing "Model Required?"
      priced cases (unrelated categories) are completely unchanged

## 11. Invoice / billing calculation for 3D Model cases

Per-case total:

```
Case Total = CaseType1BasePrice
           + (teethCount × DiePrice) if Die = Yes
           + ArticulatorPrice        if Articulator = Yes
           + DrainHolesPrice         if Drain Holes = Yes
```

- `CaseType1BasePrice` — catalog price for `(3D Model, <selected Case Type>)`, e.g. Full
  Arch Model / Quad Model / Contact Model / Horse Shoe Model / Implant Model (`per_case`,
  **$3.50**, §4).
- `teethCount` — number of teeth selected on the case's "Die Selection" tooth chart
  (`subTypeData.teeth.length`) — the same `<ToothChart>` control used for the rest of the
  case, just relabeled and only shown when Die = Yes (§8, point 4). Since the section is
  hidden and unrequired unless Die = Yes, `teethCount` is only ever meaningful — and only
  ever multiplies price — in the Die branch.
- **Die scales with teeth count** (`per_tooth`) — it's the only add-on that does.
- **Articulator is flat: Yes or No only, no relation to tooth selection at all** — confirmed.
  It never multiplies by `teethCount` and never requires a tooth selection on its own.
- Drain Holes is likewise flat (`per_case`), unrelated to teeth, unchanged from §4.

Catalog `unitType` per row (only Die changes from the §4 table; Articulator and Drain
Holes stay `per_case`):

| category   | subCategory   | unitType    | defaultPrice |
| ---------- | ------------- | ----------- | ------------ |
| `3D Model` | `Die`         | `per_tooth` | `0.50`       |
| `3D Model` | `Articulator` | `per_case`  | `0.50`       |
| `3D Model` | `Drain Holes` | `per_case`  | `0.00`       |

Updated pricing branch — replaces the code snippet in §7 for all 5 duplicated call sites
(`mapCaseToPricingInput` in `pricing.ts`, `computeCasePrice` in
`billing/clients/[clientId]/route.ts`, and the two case-sheet routes — legacy
`calculateCasePrice()` uses the simpler base-price-only version in §7 instead):

```ts
if (cat === "3d model") {
	const caseType1 = String(data.caseType1 || "Full Arch Model");
	const teethCount = Array.isArray(data.teeth) ? data.teeth.length : 0;

	let price = getPrice("3D Model", caseType1, serviceType);
	if (data.die === "yes")
		price += teethCount * getPrice("3D Model", "Die", serviceType);
	if (data.articulator === "yes")
		price += getPrice("3D Model", "Articulator", serviceType);
	if (data.drainHoles === "yes")
		price += getPrice("3D Model", "Drain Holes", serviceType);
	return parseFloat(price.toFixed(2));
}
```

For `buildInvoiceItems()` (`src/lib/invoice.ts`), which emits discrete line items rather
than a single total, a 3D Model case produces up to 4 grouped line items instead of one:

1. `3D Model - <Case Type>` — qty `1` per case, unit price = `CaseType1BasePrice`
2. `3D Model - Die` — qty = `teethCount`, unit price = `DiePrice` (only if Die = Yes)
3. `3D Model - Articulator` — qty `1` per case, unit price = `ArticulatorPrice` (only if
   Articulator = Yes) — flat, not multiplied by teeth
4. `3D Model - Drain Holes` — qty `1` per case, unit price = `DrainHolesPrice` (only if
   Drain Holes = Yes)

Aggregate across cases the same way the rest of the function already does: sum
`teethCount` for the Die line across every selected case sharing the same
`category:subCategory:serviceType` key (exactly like the existing Crown & Bridge / Implant
`per_tooth` lines); for the Articulator and Drain Holes lines, count the number of
_cases_ with that flag set (exactly like the existing `modelRequired` per-case counting
block already in `buildInvoiceItems`), then multiply once by the unit price.

**Resolved:** "die selection" is the same tooth-chart selection used for the rest of the
case — no separate control, just a relabeled title ("Die Selection") on the existing
`<ToothChart>` for the "3D Model" category (§8, point 4).

## 12. Remaining open questions

Everything below is a genuine unresolved item as of this plan revision — flag before/while
implementing, none are blockers given the safe defaults already chosen:

1. ~~Base prices for the 5 case types and Drain Holes~~ — **RESOLVED**: $3.50/case for
   each of the 5 case types, $0.00/case default for Drain Holes, both editable by admin
   via the existing Service Catalog UI (§4).
2. ~~Articulator-without-teeth fallback~~ — **RESOLVED / moot**: Articulator is confirmed
   flat (Yes/No only), never multiplied by or dependent on teeth count, so this no longer
   applies (§11).
3. ~~Legacy `/api/billing` overview showing $0 for 3D Model cases~~ — **RESOLVED**: extend
   `calculateCasePrice()` to return the flat base price ($3.50) for `'3D Model'`, ignoring
   Die/Articulator/Drain Holes on that endpoint specifically (§7, point 1).
4. **`"3D Model": "3DM"` case-number prefix** (§6) — pick of convenience, not confirmed.
5. ~~Naming overlap between the new `category: '3D Model'` and the pre-existing
   `category: 'Model', subCategory: '3D Model'` catalog row~~ — **RESOLVED**: kept as two
   coexisting, unrelated rows by design (§4) — no rename/merge.
