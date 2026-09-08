# Case Architecture — how a case is created, by category and sub-type

Reference for the current (`phase2`) case-creation model: every category, its sub-type
fields and options, the tooth-selection rule, what validates, what gets stored, and how the
`POST /api/cases` request is shaped. Written so the **3Shape XML importer**
(`xml-work-plan.md`) maps onto exactly the strings and shape the app already uses.

Verified against the code on disk at commit `a3696f3` — re-check line numbers before editing.

---

## 1. Where cases are created

| Surface | File | Who | Notes |
|---|---|---|---|
| **Client portal — "Add New Case"** | `src/app/client/(dashboard)/cases/page.tsx` | `client`, `subuser` | Own inline form. Two tabs: **Single Case**, **Bulk Upload** (≤10 rows). |
| **Admin — "Create New Case (Admin)"** | `src/components/AddCaseDialog.tsx` (mounted by `src/app/admin/(dashboard)/cases/page.tsx`) | `admin` | Same form, `role="admin"`; adds a **Select Client** step. |
| **Ops cases page** | `src/app/(ops)/cases/page.tsx` | ops roles | Has its **own local `CASE_HIERARCHY`** copy (see §11.4) — the only surface not yet on the shared module. |

All three POST to the **same** endpoint: `POST /api/cases` (`src/app/api/cases/route.ts`),
which accepts a single case object **or an array** (bulk).

The client form and `AddCaseDialog` both import the **canonical hierarchy** from
`src/lib/case-hierarchy.ts` (consolidated per `case-creation-service-enforcement-plan.md`).
`src/lib/case-utils.ts` `CATEGORY_PREFIXES` uses the same keys.

---

## 2. The `cases` row at creation (`src/db/schema/case.ts`)

`POST /api/cases` inserts one row per submitted case. Only these are set at creation; the
rest take their schema defaults.

| Column | Source at creation | Notes |
|---|---|---|
| `id` | `defaultRandom()` | |
| `clientId` | `admin` → `caseData.clientId`; `client` → own id; `subuser` → parent client's id | **UUID.** Never a raw external id. |
| `subuserId` | the subuser's own id, else `null` | |
| `createdBy` | `profile.fullName \|\| profile.email \|\| 'System'` | **The submitter**, never an operator name from a file. `varchar(255)`. |
| `caseNumber` | `formatCaseNumber(getCasePrefix(category), nextval('cases_number_seq'))` | e.g. `CAB-0042`. Unique. Prefix table in §5. Client-supplied `caseNumber` in the payload is **ignored** — server always regenerates. |
| `category` | `caseData.category` verbatim | One of the 6 canonical strings (§4). Stored as free `varchar(100)` — historical rows may hold legacy spellings. |
| `subTypeData` | `caseData.subTypeData` verbatim (jsonb) | The whole sub-type blob — §3. |
| `status` | default `'scan_received'` | Not settable at creation. |
| `serviceType` | `parseCatalogServiceType(caseData.serviceType)` → `design_only` \| `design_milling` \| `milling_only` | Must be in the client's `profiles.enabledServiceTypes` or the whole request 400s. Default `design_only`. |
| `preferredTeethLibrary` | `caseData.preferredTeethLibrary \|\| 'default'` | `'default'` \| `'other'`. |
| `teethLibraryFileUrl` / `teethLibraryFileName` | from an uploaded `.dme`/`.zip` when `preferredTeethLibrary === 'other'` | proxy URL + name. |
| `dueDate` | `caseData.dueDate` if present, else `null` | client forms don't send it today. |
| `approvalChecklist` | default `[]` | filled later at QC (`src/lib/case-approval.ts`: 7 fixed items). |
| `timeline` | default `[]` | appended to on every status change. |
| `createdAt` / `updatedAt` | `defaultNow()` | |

**Files.** The `.zip`/scan is uploaded *first* via the chunked flow
(`uploadFileInChunks` → `/api/cases/upload`, lands at R2 `<labName>/<fileName>`); the payload
then carries `uploadedFile` / `uploadedFiles: [{ fileName, fileUrl, fileSize, fileType }]`
and `POST /api/cases` inserts one `case_files` row per entry (`fileUrl` = the
`/api/cases/files?labName=…&fileName=…` proxy URL). Design deliverables live in the separate
`case_preview_files` / `outputFile` — never mixed into `case_files`.

---

## 3. `subTypeData` — the JSON contract

`subTypeData` is a single jsonb object. It always carries these **shared keys** plus the
**per-category fields** from §4.

### 3.1 Shared keys (every category)

| Key | Type | Meaning | Set by |
|---|---|---|---|
| `teeth` | `number[]` | selected tooth numbers **in the system named by `toothSystem`** (usually UNN 1–32) | `<ToothChart>` |
| `toothSystem` | `"USA"` \| `"FDI"` | numbering system for `teeth` (and `crownBridgeTeeth`) | ToothChart toggle; default `"USA"` |
| `modelRequired` | `"yes"` \| `"no"` | client wants a printed model as an add-on. **Omitted / forced `"no"` for category `3D Model`** (that category *is* a model). Default `"no"`. | radio |
| `notes` | `string` | free-text instructions; `""` if blank | textarea |
| `crownBridgeTeeth` | `number[]` | **Implants only**, and only when `caseType2 !== "None"` — the teeth for the crown/bridge attached to the implant | second `<ToothChart>` |

### 3.2 Per-category fields

Each category's `CASE_HIERARCHY[category].fields` is an ordered list of
`{ name, label, type:"select", options[], optional? }`. The form renders one `<Select>` per
field (except `die`, rendered as a checkbox in the newer forms); the chosen value lands at
`subTypeData[field.name]`. Field names are **`caseType`, `caseType1`, `caseType2`,
`occlusion`, `arch`, `die`, `articulator`, `drainHoles`** — see §4.

### 3.3 What is NOT in `subTypeData`

`clientId`, `serviceType`, `caseNumber`, `category`, `preferredTeethLibrary`,
`teethLibraryFile*`, `dueDate`, `uploadedFile(s)` — those are **top-level** payload keys, not
inside `subTypeData`.

---

## 4. Category-by-category reference

Canonical source: `src/lib/case-hierarchy.ts`. Catalog rows: `src/lib/price-list.ts`
`ensureServiceCatalogSeeded()` seed.

### 4.1 Crown & Bridge  — key `"Crown & Bridge"`, prefix `CAB`

| Field | `name` | Options |
|---|---|---|
| Case Type | `caseType` | `Crown`, `Bridge`, `Cutback`, `Coping`, `Screw Retained`, `In-Lay`, `On-Lay` |

- **Tooth selection:** required, ≥1 tooth. `<ToothChart>` (USA/FDI).
- **`modelRequired`:** shown (Yes/No).
- **Validation:** `caseType` set • `teeth.length > 0` • ≥1 file.
- **Bills:** `service_catalog (Crown & Bridge, <caseType>)`, `unit_type = per_tooth`.
- **Example `subTypeData`:**
  ```json
  { "caseType": "Bridge", "teeth": [12,13,14], "toothSystem": "USA",
    "modelRequired": "no", "notes": "" }
  ```

### 4.2 Dentures — key `"Dentures"`, prefix `CDT`

| Field | `name` | Options |
|---|---|---|
| Case Type | `caseType1` | `Reference Denture`, `Copy Denture`, `Immediate Denture`, `Full Denture`, `Partial Denture` |
| Arch | `caseType2` | `Upper`, `Lower`, `Both Arches` |

- **Tooth selection:** required, ≥1 tooth (the chart is still shown; arch is a separate field).
- **`modelRequired`:** shown.
- **Validation:** both fields set • `teeth.length > 0` • ≥1 file.
- **Bills:** `service_catalog (Dentures, <caseType1>)`, `unit_type = per_arch`. (`caseType2`/arch is metadata, not a priced row — `isFieldOptionEnabled` treats `caseType2` here as always-enabled.)
- **Example:**
  ```json
  { "caseType1": "Full Denture", "caseType2": "Both Arches", "teeth": [],
    "toothSystem": "USA", "modelRequired": "no", "notes": "" }
  ```
  (teeth may be empty in practice for a full-arch denture, but the form's generic
  `teethValid` still requires ≥1 — see §11.2.)

### 4.3 Cosmetics — key `"Cosmetics"`, prefix `CCA`

| Field | `name` | Options |
|---|---|---|
| Case Type | `caseType` | `Digital Wax Up`, `Veneers`, `Snap on Smile` |

- **Tooth selection:** required, ≥1 tooth.
- **`modelRequired`:** shown.
- **Validation:** `caseType` set • `teeth.length > 0` • ≥1 file.
- **Bills:** `service_catalog (Cosmetics, <caseType>)`, `unit_type = per_arch`.

### 4.4 Appliances — key `"Appliances"`, prefix `CAP`

| Field | `name` | Options |
|---|---|---|
| Case Type | `caseType1` | `Night Guards`, `Sport Guards`, `Mouth Guards`, `NTI` |
| Occlusion | `occlusion` | `Even Occlusion`, `Custom` |
| Arch | `arch` | `Upper`, `Lower`, `Both Arches` |

- **Tooth selection:** required, ≥1 tooth.
- **`modelRequired`:** shown.
- **Validation:** all three fields set • `teeth.length > 0` • ≥1 file.
- **Bills:** `service_catalog (Appliances, <caseType1>)`, `unit_type = per_arch`. `occlusion` and `arch` are metadata (`isFieldOptionEnabled` returns `true` for them unconditionally).
- **Catalog note:** the catalog row is `Sport Guards` (migration `0050_fix_appliances_typo.sql` renamed `Spot Guards` → `Sport Guards`, aligning it with the hierarchy).

### 4.5 Implants — key `"Implants"`, prefix `CAI`

Rendered on a **dedicated branch** in the form (not the generic field loop).

| Field | `name` | Options | Notes |
|---|---|---|---|
| Sub Type | `caseType1` | `Robotic`, `Custom`, `Ti-Base` | the implant device service |
| Crown & Bridge type | `caseType2` | `None`, `Crown`, `Bridge` | `optional: true`; default `"None"` |

- **Tooth selection:** `teeth` = the implant teeth, **required ≥1**.
- **Second tooth chart:** when `caseType2 !== "None"`, a second `<ToothChart>` appears →
  `crownBridgeTeeth`, **required ≥1**.
- **`modelRequired`:** shown.
- **Validation:** `caseType1` set • `teeth.length > 0` • (if `caseType2 !== "None"`)
  `crownBridgeTeeth.length > 0` • ≥1 file. (`caseType2` is `optional`, so `"None"` passes.)
- **Bills — two rows** (`getRequiredServiceSelections`):
  1. `(Implants, <caseType1>)` — `per_tooth`
  2. if `caseType2 !== "None"`: `(Crown & Bridge, <caseType2>)` — `per_tooth` (a *second*
     catalog lookup, under a different category)
- **Example:**
  ```json
  { "caseType1": "Ti-Base", "caseType2": "Crown",
    "teeth": [4], "crownBridgeTeeth": [4],
    "toothSystem": "USA", "modelRequired": "no", "notes": "" }
  ```

### 4.6 3D Model — key `"3D Model"`, prefix `3DM`

`3d-model-implement-plan.md` is the spec. Distinct from the `modelRequired` add-on
(that bills the separate legacy row `(Model, 3D Model)`, `per_case` $4.00, and is
**suppressed** for this category).

| Field | `name` | Options | Notes |
|---|---|---|---|
| Case Type | `caseType1` | `Full Arch Model`, `Quad Model`, `Contact Model`, `Horse Shoe Model`, `Implant Model` | primary priced service |
| Model Type | `caseType2` | `Hollow`, `Solid` | **metadata only**, not priced |
| Die | `die` | `Yes`, `No` | rendered as a **checkbox** in the newer forms |
| Articulator | `articulator` | `Yes`, `No` | flat add-on |
| Drain Holes | `drainHoles` | `Yes`, `No` | flat add-on |

- **"Model Required?" control is hidden**; `modelRequired` not submitted (or `"no"`).
- **Tooth selection:** **hidden and not required** — *unless* `die === "Yes"`, when a
  `<ToothChart>` titled **"Die Selection"** appears and becomes **required ≥1** (Die price =
  `teeth.length × $0.50`). Toggling `die` back to `No` clears `teeth`.
- **Validation:** `caseType1`, `caseType2`, `die`, `articulator`, `drainHoles` all set •
  `die !== "Yes" || teeth.length > 0` • ≥1 file.
- **Bills — up to 4 rows** (`getRequiredServiceSelections`):
  1. `(3D Model, <caseType1>)` — `per_case` $3.50
  2. if `die === "Yes"`: `(3D Model, Die)` — `per_tooth` $0.50
  3. if `articulator === "Yes"`: `(3D Model, Articulator)` — `per_case` $0.50
  4. if `drainHoles === "Yes"`: `(3D Model, Drain Holes)` — `per_case` $0.00
  (`caseType2` Hollow/Solid → always-enabled in `isFieldOptionEnabled`.)
- **`modelOnlyLab`:** a client flagged `profiles.modelOnlyLab` can *only* create `3D Model`
  cases — the category `<Select>` is locked to it and `POST /api/cases` 400s anything else.
- **Example:**
  ```json
  { "caseType1": "Full Arch Model", "caseType2": "Hollow",
    "die": "Yes", "articulator": "No", "drainHoles": "No",
    "teeth": [3,4,5], "toothSystem": "USA", "notes": "" }
  ```

### 4.7 Quick matrix

| Category | key | prefix | fields (`subTypeData` keys) | teeth required? | 2nd tooth set | catalog unit |
|---|---|---|---|---|---|---|
| Crown & Bridge | `Crown & Bridge` | `CAB` | `caseType` | yes | — | per_tooth |
| Dentures | `Dentures` | `CDT` | `caseType1`, `caseType2`(arch) | yes* | — | per_arch |
| Cosmetics | `Cosmetics` | `CCA` | `caseType` | yes | — | per_arch |
| Appliances | `Appliances` | `CAP` | `caseType1`, `occlusion`, `arch` | yes | — | per_arch |
| Implants | `Implants` | `CAI` | `caseType1`, `caseType2`(opt) | yes | `crownBridgeTeeth` when `caseType2≠None` | per_tooth (+ C&B per_tooth) |
| 3D Model | `3D Model` | `3DM` | `caseType1`, `caseType2`(Hollow/Solid), `die`, `articulator`, `drainHoles` | only if `die=Yes` | — | per_case (+ Die per_tooth) |

\* generic `teethValid` requires ≥1 for every non-3D-Model category (§11.2).

---

## 5. Case number

`src/lib/case-utils.ts`:

```
CATEGORY_PREFIXES = {
  "Crown & Bridge": "CAB", "Dentures": "CDT", "Cosmetics": "CCA",
  "Appliances": "CAP", "Implants": "CAI", "3D Model": "3DM"
}
getCasePrefix(category) → CATEGORY_PREFIXES[category]  ??  <initials of category, padded to 3 with "X">
formatCaseNumber(prefix, seq) → `${prefix}-${String(seq).padStart(4,"0")}`   // CAB-0042
```

Sequence: `nextval('cases_number_seq')` (created on demand). **A category string that isn't
an exact key falls through to the initials path** — so the importer must emit these exact
keys or case numbers silently degrade (e.g. `"Implant"` → `IMX`, `"Crown & Bridges"` → `CBX`).

---

## 6. Tooth selection (`src/components/ToothChart.tsx`)

- Two numbering systems, toggled in-widget: **USA Universal (1–32)** and **FDI**. The
  active system is stored as `subTypeData.toothSystem`; `teeth` / `crownBridgeTeeth` hold
  numbers **in that system**. Toggling translates the stored array via the built-in
  `USA_TO_FDI` map (unmapped values dropped).
- `selected: number[]`, `onChange`, `system`, `onChangeSystem` — controlled.
- Plain click toggles; **Ctrl+click** selects a visual range.
- Layout arrays: `UPPER_USA = 1..16`, `LOWER_USA = 32..17`; `UPPER_FDI = 18..11,21..28`,
  `LOWER_FDI = 48..41,31..38`.
- **UNN passes straight through** for the 3Shape importer: `system="USA"` + `teeth` as
  1–32 needs no conversion.

`extractCaseTeethInfo(category, subTypeData)` (`src/lib/export-csv.ts`) derives the display
label: Crown & Bridge / Implants → `#12, #13` + `Universal (USA)`/`FDI`; Appliances /
Dentures / Cosmetics → `"<arch> Arch"` (from `arch` or `caseType2`), numbering `—`;
anything else → `1 case`.

---

## 7. Service flow & catalog enforcement

### 7.1 `serviceType` (flow)

`design_only` | `design_milling` | `milling_only` (`serviceTypeEnum`). Column
`cases.serviceType`, default `design_only`. The form only shows the radio when the client
has **>1** enabled flow (`profiles.enabledServiceTypes`, fetched from
`/api/client/service-types` or `/api/admin/clients/[id]/service-types`). `POST /api/cases`
rejects (400) any case whose `serviceType` isn't in that list. The flow drives the whole
downstream status machine (`src/lib/case-status-mapping.ts` — `design_only` ends at client
approval; `design_milling` / `milling_only` route through milling-centre statuses).

### 7.2 Per-service enable/disable

`service_catalog (category, subCategory, serviceType)` has `isActive`; per-client
`client_price_list.isEnabled` overrides it (both must be true). The form filters options via
`isCategoryAvailable` / `isFieldOptionEnabled` / `buildEnabledKeySet` against a fetched
price list. `POST /api/cases` re-checks server-side: `getRequiredServiceSelections(category,
subTypeData)` returns the `{category, subCategory}[]` a submission touches (1 for simple
categories; up to 4 for 3D Model; 2 for Implants with a C&B attachment), and any selection
not present-and-`isEnabled` in `getPriceListForClient(clientId, serviceType)` → 400.

---

## 8. The `POST /api/cases` request

**Payload** (`src/app/api/cases/route.ts`), single object or array:

```jsonc
{
  "clientId": "<uuid>",              // admin only; ignored for client/subuser
  "serviceType": "design_only",
  "category": "Crown & Bridge",
  "subTypeData": {
    "caseType": "Bridge",
    "teeth": [12,13,14],
    "toothSystem": "USA",
    "modelRequired": "no",
    "notes": "",
    "crownBridgeTeeth": []           // Implants + caseType2≠None only
  },
  "caseNumber": "CAB",               // sent by the form, but SERVER REGENERATES it
  "uploadedFile":  { "fileName": "...", "fileUrl": "...", "fileSize": 0, "fileType": "" },
  "uploadedFiles": [ /* same shape; preferred */ ],
  "preferredTeethLibrary": "default",
  "teethLibraryFileUrl": null,
  "teethLibraryFileName": null,
  "dueDate": null
}
```

Sent as `multipart/form-data` with a single field `cases` = `JSON.stringify(payload)`
(browser path), or raw JSON (API path).

**Server sequence per request:**
1. Auth → resolve `clientId` (+ `subuserId`) by role.
2. **Duplicate guard** (client/subuser only): if any `uploadedFile(s).fileName` already
   exists on a `case_files` row for one of this client's cases in an **active** status
   (`ACTIVE_CASE_STATUSES` = every status whose lifecycle step ≠ `Completed`) → **409, whole
   request rejected**.
3. Load client profile → `labName`, `enabledServiceTypes`, `modelOnlyLab`.
4. Per case in the array:
   a. `serviceType` in `enabledServiceTypes`? else 400.
   b. `modelOnlyLab` and `category !== "3D Model"`? → 400.
   c. `getRequiredServiceSelections` all enabled in the flow's price list? else 400.
   d. `caseNumber = formatCaseNumber(getCasePrefix(category), nextval(seq))`.
   e. insert `cases` row; insert `case_files` rows; `notifyCaseSubmitted`; `logActivity('case.created')`.
5. `invalidateCasesCache(clientId)`; return `{ data: <case | case[]> }`, 201.

There is **no per-item isolation** — the first failing case 400s the whole batch (bulk
submit is all-or-nothing).

---

## 9. Editing a case after creation

`PUT /api/cases/[id]` (`src/app/api/cases/[id]/route.ts`):

- `client` / `subuser` / `admin` may change `category`, `subTypeData` (also `caseNumber`,
  `dueDate`) **only while `status ∈ EDITABLE_STATUSES`** = `scan_received`,
  `allocated_to_designer`, `scan_verified`, `scan_not_verified`. After work starts → 403
  "Cannot edit case details after work has started".
- `qc` / `designer` **cannot** touch `category` / `subTypeData` / assignments — 403.
- `serviceType` is **not** editable via PUT (set once at creation; PUT only *reads* it for
  flow-aware status transitions).
- There is no dedicated "edit case" dialog in the UI today — the client's realistic path
  for a wrong sub-type is delete-and-resubmit while still editable, or ask an admin.

---

## 10. How `subTypeData` renders back

`renderSubTypeSummary` (`src/components/CaseDetailView.tsx:185`), the "restoration" label in
both cases pages, and `export-csv.ts` all build a human string by taking **every string
value** in `subTypeData` **except** a hard-coded skip list:
`teeth`, `crownBridgeTeeth`, `toothSystem`, `notes`, `modelRequired` — and dropping values
equal to `"none"` (case-insensitive).

**Consequence:** any *new* scalar string key added to `subTypeData` (e.g. a
`sourceOrderId`) would leak into the case-list restoration column and the CSV. New
structured data (like the 3Shape importer's provenance) must go under a **nested object**
key — objects are excluded by the `typeof value === "string"` test. (`CaseDetailView` also
renders unknown `subTypeData` keys generically as `Label: Value` rows in the detail card.)

---

## 11. Known divergences & gotchas

1. **Historical category strings.** `cases.category` is free text. Rows created before the
   `case-creation-service-enforcement-plan.md` consolidation may hold `"Implant"`,
   `"Crown & Bridges"`, `"Denture"`, `"Cosmetic"`, `"Appliance"`. UI code still has
   `=== "Implant"` / `=== "Implants"` compatibility branches. New writes use the canonical
   6 keys.
2. **`teethValid` is blunt.** The shared `hasAllRequiredCaseFields` requires `teeth.length
   > 0` for *every* category except `3D Model` (and `3D Model` only when `die === "Yes"`).
   So a full-arch Denture / Appliance technically still needs ≥1 tooth ticked even though
   the billable unit is an arch.
3. **Two "model" concepts.** `subTypeData.modelRequired: "yes"` bills the legacy catalog row
   `(Model, 3D Model)` `per_case` $4.00 as an **add-on on another category**. The `3D Model`
   **category** bills its own `(3D Model, …)` rows. They never share a code path; the
   `modelRequired` control is hidden for the `3D Model` category.
4. **Ops page copy.** `src/app/(ops)/cases/page.tsx` still defines its own local
   `CASE_HIERARCHY` (its Implants `caseType2` options are `crown/bridge/coping/screw
   retained/in-lay/on-lay`, not `None/Crown/Bridge`). Treat `src/lib/case-hierarchy.ts` +
   `AddCaseDialog` + the client page as the source of truth; the ops form is a known
   straggler.
5. **`caseNumber` in the payload is a lie.** The forms compute and send a bare prefix
   (`generateCaseId(category)` → `"CAB"`); `POST /api/cases` ignores it and formats its own
   from the sequence.
6. **Bulk = all-or-nothing.** One invalid row 400s the whole `POST /api/cases` array.

---

## 12. What the 3Shape XML importer must produce

To land a case identically to the manual form (`xml-work-plan.md` §3/§6):

- `category` = one of **`Crown & Bridge` | `Dentures` | `Cosmetics` | `Appliances` |
  `Implants` | `3D Model`** exactly (or `null` → client picks). Never a legacy spelling.
- `subTypeData` = the shared keys (`teeth` UNN, `toothSystem:"USA"`, `modelRequired` default
  `"no"` — omit for `3D Model`, `notes`) **plus** that category's field keys from §4, using
  the **exact option strings** in `CASE_HIERARCHY` (`Night Guards`, `Veneers`, `Bridge`, …).
- Implants: split into `caseType1` (device) + `caseType2` (`None`/`Crown`/`Bridge`) +
  `crownBridgeTeeth`.
- Dentures: `caseType1` (denture type) + `caseType2` (arch).
- Anything not confidently derivable → leave the field blank and flag it; the carousel form
  makes the client complete it before `POST /api/cases`.
- Provenance goes under `subTypeData.threeShape` (object) so §10's summary/CSV logic skips it.
- Don't send `caseNumber`; don't send `serviceType` unless the client picked one (default
  `design_only`); the zip is the `uploadedFile`.
- Expect `POST /api/cases` to still enforce the service-catalog check — a client whose
  price list has, say, `In-Lay` disabled cannot be handed an `In-Lay` draft that submits.
