# 3Shape XML Import — Work Plan

**Feature:** Let a dental lab (client / subuser) drop up to **5 3Shape "DentalContainer"
packages** (`.zip` exports; folder / `.dentalproject` equivalents later) into the *Add New
Case* dialog. The server opens each package, parses the DentalContainer XML **and** inspects
the archive contents, extracts every meaningful field, normalises it into a domain model,
validates it, and hands the client a **carousel of pre-filled case forms** — one per
extracted order — that they review, correct, and submit in a single batch. Anything the
package can't tell us is **flagged for manual entry, never silently guessed**.

This document is the implementation contract for the `xml-feature` branch. It assumes the
read-only analysis toolkit in `scripts/case-xml-extract/` (`extract.mjs`, `lib/*.mjs`,
`data-extraction.md`, plus `CASE-XML-MAPPING.md` in `case_data/`) is correct about *what the
XML contains* — the job here is to turn that analysis into a production path inside `src/`.

> `scripts/case-xml-extract/` is git-ignored (`.gitignore:56`), so the runtime code
> deliberately does **not** live there — it goes in `src/lib/three-shape/` (§2). This plan
> sits at the repo root next to `milling-implementation-plan.md` so it is tracked on the
> branch.

---

## Implementation status (`xml-feature` branch)

| Area | Status |
|---|---|
| `src/lib/three-shape/` — XML + range-ZIP readers, DentalContainer parser, taxonomy bridge, order→draft mapper, asset classifier, full `ThreeShapeCase` assembly, raw-scan handling, package orchestrator (Q4) | **done** |
| `src/lib/three-shape/r2-zip.ts` — R2 `GetObject` Range reader | **done** |
| `POST /api/cases/xml-extract` — read-only extraction endpoint (client/subuser only, ≤5, lab-scoped keys, per-package isolation, advisory duplicate check) | **done** |
| `POST /api/cases` — `skipIfDuplicate` + `skipped[]` (Q2, active-only, within-batch dedupe) | **done** |
| `src/components/ThreeShapeImport/` — upload tab + review carousel + `DraftCaseForm` + "from the package" panel; wired into the client cases page as a 3rd tab | **done** |
| `CaseDetailView` — "Imported from 3Shape" collapsible panel reading `subTypeData.threeShape` | **done** |
| `vitest` + 33 tests (xml / zip range-read / parser / taxonomy / package incl. a guarded pass over the real `case_data/` samples) | **done** |
| `scripts/verify-3shape.ts` — throwaway end-to-end harness | **done** (delete before merge, or fold into tests) |
| `case_imports` audit table, admin-side import, `.dentalproject` folder inputs | **deferred** (v2 — §16) |

Verified end-to-end against all 11 real sample zips: bridges + connector spans, implant
Ti-Base/Custom split, tooth numbers, and the raw-scan fallback all match
`CASE-XML-MAPPING.md`. Sections below are the design of record; a few sub-points the code
refined in practice are noted inline.

---

## 0. TL;DR of what gets built

| # | Piece | Location | New / changed |
|---|---|---|---|
| 1 | 3Shape→app taxonomy map + `teArtificialTooth`/`teGingivaFD` classes (canonical `CASE_HIERARCHY` **already exists** — see §7 / `case-architecture-plan.md`) | `src/lib/case-hierarchy.ts` / runtime | **small add** |
| 2 | Layered 3Shape extraction pipeline (TS port of `lib/*.mjs`, extended) | `src/lib/three-shape/` | **new** |
| 3 | Normalized domain model `ThreeShapeCase` (raw + normalized, components, sub-arrays, dataQuality) | `src/lib/three-shape/model.ts` | **new** |
| 4 | Range-request ZIP reader + archive asset classifier | `src/lib/three-shape/r2-zip.ts` | **new** |
| 5 | Extraction endpoint (read-only, no DB writes) | `src/app/api/cases/xml-extract/route.ts` | **new** |
| 6 | "3Shape Import" tab + review carousel | `src/app/client/(dashboard)/cases/page.tsx` + `src/components/ThreeShapeImport/` | **new** |
| 7 | Finer duplicate rule (zip name + tooth overlap, opt-in) | `src/app/api/cases/route.ts` POST | **changed** |
| 8 | Full domain model + provenance stored on the case | `subTypeData.threeShape` (jsonb, no migration) | **changed shape** |
| 9 | Fixtures + parser + regression tests | `src/lib/three-shape/__tests__/`, uses `case_data/` | **new** |

No database migration is required for v1. A `case_imports` audit table
(`data-extraction.md` §25) is deferred to v2 and noted in §16.

---

## 1. End-to-end workflow (what the client sees)

1. Client opens **Cases → Add New Case**. A third tab appears next to *Single Case* and
   *Bulk Upload*: **3Shape Import**.
2. Client selects/drops **1–5 `.zip`** files. Each zip uploads immediately to R2 through the
   **existing** chunked multipart flow (`uploadFileInChunks` → `/api/cases/upload`), landing
   at `<labName>/<fileName>` exactly like any other case file. No new upload code.
3. When all zips are uploaded, the client clicks **Extract**. The UI calls
   `POST /api/cases/xml-extract` with the list of `{ fileName, fileUrl, fileSize, fileType }`
   it just uploaded.
4. The server, **per package, independently**, runs the pipeline (§2):
   *locate & parse the one order XML → inspect archive → extract → normalise → validate →
   map to draft*. **One zip = one case** (§5.2a / Q4): a zip carrying more than one order,
   or an order XML not named after the zip, comes back as an **error** telling the client to
   split the upload. It returns, per package:
   `{ ok, draft, normalized, dataQuality, duplicateOf }` (§3, §6).
5. The UI shows a **carousel**: one pre-filled case form per successful draft (so ≤5 cards),
   `‹ ›` arrows and a `2 / 5` counter. Each form is the same category / sub-type / tooth-chart /
   model-required / notes / teeth-library form the single-case tab renders. Fields the
   extractor filled are normal; fields in `dataQuality.warnings` (or with
   `requiresReview`) are highlighted amber with the reason ("Order item references tooth 12
   but ToothElement specifies tooth 7 — used 7").
6. Drafts flagged `duplicateOf` render with a **"Skip — already in {caseNumber}"** banner
   and a checkbox to force-create. Packages that failed to parse render as an **error card**
   with the message and a "create a blank case from this zip" fallback.
7. Client edits anything, then clicks **Submit N cases**. The UI builds an array body and
   calls the **existing** `POST /api/cases` (it already accepts an array). Each entry
   carries `uploadedFile` / `uploadedFiles` = that zip, the (edited) `category` +
   `subTypeData`, and `subTypeData.threeShape` = the full normalized domain model. The
   server assigns case numbers from `cases_number_seq`.
8. Result toast: "4 cases created, 1 skipped as duplicate." Carousel closes, list refreshes.

**Non-negotiables:** extraction never writes to the DB; a case is created only after the
client presses Submit; one broken package never blocks the others.

---

## 2. Architecture — the extraction pipeline

The core principle from the deep spec:

> **Extract structured relationships first. Interpret human-readable text second.**

The XML is **not** a flat document. It is a hierarchical CAD/CAM case:

```
Order
 ├─ ModelJob(s)
 │   ├─ ModelElement(s)          material, colour, manufacturing, CAD file, validation
 │   │   └─ ToothElement(s)      ← ToothNumber + CacheToothTypeClass + toothElementTypeID
 │   └─ Scan(s)
 ├─ Link(s) ── LinkToothElement(s) ── ToothElement(s)     connectors / bridge topology
 ├─ SplitBridgeLink(s)
 ├─ CustomData(s)
 └─ OrderExchangeAttachment(s) / Attachment(s)
```

…plus the **archive** (CAD, scans, screenshots, anatomy, external models, order source,
material/manufacturer definitions, design tree).

### 2.1 Layers — never mix parsing with DB insertion

```
RAW 3SHAPE PACKAGE
      │  parser.ts + xml.ts + r2-zip.ts
      ▼
EXTRACTION            extractors/*   — one file per list, dumb field pulls, raw values only
      │
      ▼
NORMALIZED DOMAIN MODEL   model.ts (ThreeShapeCase) — raw + normalized side by side (§3)
      │  classifiers/*  + normalizers/*
      ▼
VALIDATION           validators/*   — conflicts, missing refs, unknown classes → dataQuality (§11)
      │
      ▼
APPLICATION MAPPING  mappers/case.ts — domain model → { flat subTypeData for the form, threeShape }
      │
      ▼
DATABASE             POST /api/cases (existing) — assigns caseNumber, inserts
```

The **normalized domain model is independently testable** with zero DB / HTTP. That is
where the regression suite (§15.3) runs.

### 2.2 TypeScript module layout (`src/lib/three-shape/`)

Mirrors the spec's Python layout; do **not** build one giant parse function.

```
src/lib/three-shape/
├── index.ts                 extractPackage(reader, packageName, ctx) → { normalized, dataQuality }
├── xml.ts                   port of lib/xml.mjs — tokeniser, walk/find. NOT a full XML parser (§14)
├── zip.ts                   port of lib/zip.mjs — central-directory walk, inflateRawSync
├── r2-zip.ts                openZipFromR2(key): RangeReader-backed zip (§5)
├── model.ts                 ThreeShapeCase + all sub-types (§3)
├── extractors/
│   ├── order.ts             TDM_Item_Order → raw order fields
│   ├── patient.ts           Patient_* → { refNo, firstName, lastName, fullName, guid }
│   ├── model-jobs.ts        TDM_Item_ModelJob
│   ├── model-elements.ts    TDM_Item_ModelElement (material, colour, mfg, CAD file, validation, dates)
│   ├── tooth-elements.ts    TDM_Item_ToothElement  ← the important one
│   ├── links.ts             TDM_Item_Link + TDM_Item_LinkToothElement + SplitBridgeLink
│   ├── scans.ts             TDM_Item_Scan
│   ├── attachments.ts       OrderExchangeAttachmentList / AttachmentList / groups
│   ├── custom-data.ts       TDM_Item_CustomData (public + internal)
│   └── lookups.ts           Materials.xml → toothElementType / material / colour / linkType maps
├── classifiers/
│   ├── category.ts          multi-signal category (§4)
│   ├── components.ts        build components[] from tooth classes + links (§4.3)
│   └── tooth.ts             CacheToothTypeClass → normalized class + requiresReview
├── normalizers/
│   ├── category.ts          script taxonomy → app taxonomy (THREESHAPE_CATEGORY_MAP)
│   ├── scan.ts              stPreparation → "Preparation", etc. (raw always kept)
│   ├── material.ts          pass-through unless a mapping table exists (§spec 20)
│   └── datetime.ts          Unix epoch **seconds** → ISO UTC (§spec 43)
├── validators/
│   ├── case.ts              assemble dataQuality { warnings[], errors[], requiresReview }
│   ├── tooth.ts             Items-text tooth vs ToothElement.ToothNumber conflict
│   ├── references.ts        every ModelFilename / scan FileName resolvable in the archive?
│   └── assets.ts            classify + inventory archive entries (§5.3)
├── mappers/
│   └── case.ts              domain model → { category, subTypeData(form fields), threeShape }
└── __tests__/
    ├── fixtures/            copied subset of case_data/
    ├── crown/ bridge/ splint/ coping/ denture/ implant/ raw-scan/
    └── regression.test.ts   the 7 cases in §15.3
```

### 2.3 Two parsers, kept honest

`map-to-case.mjs` already hand-mirrors the app hierarchy. After the port there are still two
parsers (the `scripts/` CLI, the `src/` runtime). Keep `scripts/case-xml-extract/` for
offline analysis; `src/lib/three-shape/` is the runtime. Add a **drift-guard test** (§15.4)
that runs both over `case_data/` and asserts `category` + component tooth lists match.

### 2.4 Cost / where it runs

Per package: a few small range GETs + `inflateRawSync` of `<5 MB` of XML + an O(n) regex
tokenise (≤ ~40 MB). Budget **≤ 3 s/package**, **≤ 20 s** for 5, run **synchronously in the
request** (PM2, no serverless cap). `export const maxDuration = 60` as a backstop. If XMLs
prove huge, move to a BullMQ job (the app has `bullmq`) and poll — noted, not built.

---

## 3. The normalized 3Shape domain model (`ThreeShapeCase`)

This is the heart of the deep spec (spec §53–56, §60, §65). It is persisted **verbatim**
under `cases.subTypeData.threeShape` so a case can be reconstructed and re-mapped **without
reopening the package**. Every interpreted field keeps its **raw** counterpart.

```ts
// src/lib/three-shape/model.ts

export interface ThreeShapeCase {
  source: {
    system: "3shape";
    containerVersion: string | null;      // DentalContainer @version, e.g. "2022-1"
    parserVersion: string;                // semver; bump policy in §16.1
    packageName: string;                  // the uploaded zip file name
    extractedAt: string;                  // ISO
  };

  sourceIds: {
    sourceOrderId: string | null;         // IntOrderID  — NOT the app caseNumber
    numericOrderId: string | null;        // NumOrderID
    externalOrderId: string | null;       // ExtOrderID
    importOrderId: string | null;         // ImportOrderID
    originalOrderId: string | null;       // OriginalOrderID
    clientOrderNo: string | null;
    sourceClientId: string | null;        // 3Shape ClientID — NOT a UUID (§12)
  };

  patient: {
    refNo: string | null;
    firstName: string | null;
    lastName: string | null;
    fullName: string | null;              // joined; lastName may already hold the full name
    guid: string | null;
  };

  order: {
    customer: string | null;             // Customer
    manufacturerName: string | null;     // ManufName
    erpCustomerNo: string | null;
    contactPerson: string | null;
    comments: string | null;             // OrderComments (verbatim) → cases.clientMassage
    importance: string | null;           // OrderImportanceID
    operatorId: string | null;
    operatorName: string | null;         // NEVER auto-mapped to designerId / createdBy (§12)
    source: {                            // "how the case was made"
      createdFromApp: string | null;     // appDentalDesigner / appDentalManager
      designModule: string | null;       // DentalDesigner / SplintStudio / DD2024 …
      modelDesignModule: string | null;  // mdmModelBuilder / mdmModelBuilderExpress / null
      scanModule: string | null;
      faceScanModule: string | null;
      scanSource: string | null;         // ssImport / ssImportThirdPartySTL …
      modelManufacturingId: string | null;
    };
    rawItems: string | null;             // OrderList.Items — CONTEXT ONLY, never authoritative
  };

  classification: {
    category: string;                    // normalized, app taxonomy or "Unknown"
    scriptCategory: string;              // pre-normalisation ("Crown & Bridge", "3D Model" …)
    rawToothClasses: string[];           // every CacheToothTypeClass seen, de-duped
    normalizedClasses: string[];         // Crown / Abutment / Splint / Coping / Bridge / Gingiva …
    subtypeIds: string[];                // every toothElementTypeID, verbatim (do NOT split)
    toothNumbers: number[];              // UNN, authoritative, sorted, de-duped
    isMultiComponent: boolean;
    components: Component[];             // §4.3 — case may have >1 component type
  };

  modelJobs: ModelJob[];
  modelElements: ModelElement[];
  toothElements: ToothElement[];
  relationships: {
    links: Link[];                       // LinkID, LinkTypeID, CacheLinkTypeClass, ModelElementID
    linkToothElements: LinkToothElement[]; // LinkID ↔ ToothElementID
    splitBridgeLinks: unknown[];         // preserved raw if present
    connectorSpans: number[][];          // union-find over ltConnector links → [[12,13,14], …]
  };

  scans: Scan[];                         // raw + normalized ScanType, resolved archive path
  attachments: Attachment[];             // screenshots etc. — NOT clinical scans
  assets: Asset[];                       // every archive entry, classified (§5.3)
  customData: CustomDatum[];             // public + internal, raw

  sourceStatus: {                        // 3Shape processing state — NOT app status (§12)
    processStatusId: string | null;      // psModelled …
    altProcessStatusId: string | null;
    processLockId: string | null;        // plReady …
    validationResult: string | null;     // vrPassed / vrFailed (order/model level summary)
  };

  timestamps: {                          // ISO UTC, converted from epoch seconds
    createDate: string | null;
    deliveryDate: string | null;         // REQUESTED date — not proof of delivery (§12)
    shippingDate: string | null;
    receiveDate: string | null;
    maxScanDate: string | null;
  };

  dataQuality: DataQuality;              // §11
}

export interface Component {
  type: string;                          // "Crown" | "Abutment" | "Crown Pontic" | "Artificial Teeth" | "Gingiva" | …
  modelElementId: string | null;
  toothNumbers: number[];                // UNN
  subtypeIds: string[];
  material: { id: string | null; name: string | null } | null;
}

export interface ToothElement {
  toothElementId: string;
  modelElementId: string | null;
  toothNumber: number | null;            // UNN — AUTHORITATIVE tooth selection
  fdi: number | null;                    // derived, for display only
  arch: "Upper" | "Lower" | null;
  rawClass: string;                      // CacheToothTypeClass, verbatim
  normalizedClass: string;               // mapped; "Unknown" + requiresReview if unmapped
  rawSubtypeId: string | null;           // toothElementTypeID, verbatim, unsplit
  anatomical: boolean;
  postAndCore: boolean;
  abutmentKitId: string | null;
}

export interface ModelElement {
  modelElementId: string;
  modelJobId: string | null;
  materialId: string | null;   materialName: string | null;   rawMaterialName: string | null;
  colorId: string | null;      colorName: string | null;      rawColor: string | null;
  manufacturingProcessId: string | null;
  camProcessId: string | null; camProcessName: string | null;
  manufacturerId: string | null; manufacturerName: string | null;
  modelElementType: string | null;       // meIndicationRegular / meSplint …
  validationResult: string | null;       // vrPassed / vrFailed  (+ normalized: passed boolean)
  processStatusId: string | null; altProcessStatusId: string | null; processLockId: string | null;
  modelFilename: string | null;          // CAD/model INPUT path — NOT the app outputFile (§12)
  resolvedAssetPath: string | null;      // matched archive entry, or null → MODEL_FILE_NOT_FOUND
  geometry: { height: number | null; volume: number | null; boundingBox: { min: number[]; max: number[] } | null };
  virtualItem: boolean;
  comment: string | null;
  items: string | null;                  // ModelElement.Items — context only
  dates: { create: string | null; delivery: string | null; shipping: string | null; receive: string | null };
}

export interface ModelJob { modelJobId: string; orderId: string | null; }

export interface Link { linkId: string; linkTypeId: string | null; cacheLinkTypeClass: string | null; modelElementId: string | null; }
export interface LinkToothElement { linkToothElementId: string; linkId: string; toothElementId: string; }

export interface Scan {
  scanId: string;
  rawScanType: string;                   // stPreparation / stPreparationIntraOral / stGenericDoublePrep / stAntagonist / stWaxRim …
  normalizedScanType: string;            // "Preparation" / "Preparation Intraoral" / …
  modelJobId: string | null;             // may be the only link — ModelElementID / ToothElementID often null
  modelElementId: string | null;
  toothElementId: string | null;
  scanDate: string | null;
  scanName: string | null;
  fileNameInXml: string | null;          // often empty
  resolvedAssetPath: string | null;      // discovered by scanning Scans/** in the archive (§5.3)
}

export interface Attachment { attachmentId: string | null; type: string | null; fileName: string | null; path: string | null; resolvedAssetPath: string | null; }

export interface Asset {
  path: string;                          // exact archive-relative path
  sizeBytes: number;
  kind: "CAD" | "SCAN" | "SCREENSHOT" | "ANATOMY" | "EXTERNAL_MODEL" | "ORDER_SOURCE"
      | "MATERIAL_DEFINITION" | "MANUFACTURER_DEFINITION" | "DESIGN_TREE" | "OTHER";
  encrypted: boolean;                    // 3Shape .3ml archives are password-protected
}

export interface CustomDatum { customDataId: string | null; fieldId: string | null; fieldCaption: string | null; value: string | null; kind: "public" | "internal" | string; }

export interface DataQuality {
  valid: boolean;
  requiresReview: boolean;
  warnings: Array<{ code: WarningCode; message: string; resolution?: string; field?: string }>;
  errors: Array<{ code: string; message: string }>;
}
```

**Storage note (§16, §12.2):** the full model is large-ish but bounded (a handful of KB of
JSON for typical cases; dentures with 28 tooth elements a bit more). It goes under the
**object** key `subTypeData.threeShape` so the sub-type-summary derivations that walk string
values skip it entirely (§12.2). If it ever gets unwieldy, move it to the deferred
`case_imports` table (§16).

---

## 4. Classification — structured-data-first, multi-signal

### 4.1 Never classify from text alone

Do **not** write `if "bridge" in items: category = "Bridge"`. Evaluate **all** signals and
derive:

```
OrderList.Items  +  ToothElement.CacheToothTypeClass (set)  +  ModelElement type
+ number of model elements  +  Link / LinkToothElement topology  +  design module  +  material
```

The existing toolkit's `pickCategory` (in `map-to-case.mjs`) already does priority-ordered
structural detection (`teAbutment → Implants`, `teSplint / meSplint → Appliances`, connector
links / `teCrownPontic` → Bridge, …). Port it and **extend** for dentures (§4.4).

### 4.2 Authoritative source priority (spec §59, §70)

| Question | Priority (first wins) |
|---|---|
| **Tooth number** | `ToothElement.ToothNumber` → structured related data → `ModelElement` → `OrderList.Items` → filename/text |
| **Tooth type / category** | `ToothElement.CacheToothTypeClass` → combination of classes → `ModelElement` type → `OrderList.Items` → module/source |
| **Subtype** | `ToothElement.toothElementTypeID` (verbatim) |
| **Model relationship** | `ToothElement.ModelElementID` |
| **Link relationship** | `LinkToothElement.LinkID` + `.ToothElementID` |
| **Material** | `ModelElement.MaterialID` → `ModelElement.CacheMaterialName` → `Materials.xml` → order-level `CacheMaterialName` |
| **Physical files** | actual archive entry → XML reference → filename text |

Whenever `OrderList.Items` (FDI-ish, human text) disagrees with `ToothElement.ToothNumber`
(UNN, structural), **use `ToothNumber`** and emit `TOOTH_NUMBER_CONFLICT` (§11).
`CASE-XML-MAPPING.md` confirms UNN passes straight into `ToothChart` with `system="USA"` —
**no conversion**.

### 4.3 The component model — do not flatten

A single case can carry more than one component type:

- **Crown + Abutment** (implant): `teCrown` + `teAbutment` on the same tooth.
- **Bridge**: `teCrown` / `teCrownPontic` / `teCrown` joined by `ltConnector` links.
- **Denture**: `teArtificialTooth` (×N) + `teGingivaFD` (×N).

`classifiers/components.ts` groups tooth elements by `(modelElementId, normalizedClass)` and,
for bridges, by connector span, producing `classification.components[]`. Normalising to a
single `category` (e.g. `"Bridge"`, `"Denture"`) **must not destroy** the raw classes,
subtype ids, or per-component tooth lists.

### 4.4 Denture / full-arch — ONE case, not 28

Pattern: `Items = "Artificial teeth in block 17-27, 37-47, Gingiva 17-27, 37-47"`, classes
`teArtificialTooth` + `teGingivaFD`.

- `category = "Dentures"` (canonical app key — §7).
- `components = [{ type:"Artificial Teeth", toothNumbers:[…] }, { type:"Gingiva", toothNumbers:[…] }]`.
- Form `subTypeData.teeth` = union of the artificial-teeth UNNs.
- `subTypeData.caseType1` (Full/Partial/…) → **blank + `DENTURE_TYPE_UNKNOWN`** (Q6).
- `subTypeData.caseType2` (arch) → **derived** from the tooth-element arches, pre-filled,
  `ARCH_INFERRED` (Q6).
- **Never** emit 28 draft cases from one denture package.

New entries for `classifiers/tooth.ts` normalisation map (extend the toolkit's
`TOOTH_CLASSES`, which today lacks these):

| raw | normalized |
|---|---|
| `teArtificialTooth` | Artificial Tooth |
| `teGingivaFD` | Gingiva |
| `teCrown` | Crown |
| `teCrownPontic` | Crown Pontic |
| `teAbutment` | Abutment |
| `teCoping` | Coping |
| `teSplint` | Splint |
| *(unmapped)* `teXxx` | **Unknown** + `requiresReview: true`, logged (§11, spec §69) |

### 4.5 Worked examples (all must pass — §15.3)

| Package says | Structural truth | Normalized result |
|---|---|---|
| `Items = Crown 14` | `ToothNumber 5`, `teCrown` | `Crown`, teeth `[5]` (not 14) |
| `Items = Crown 15, Abutment 15` | crown `ToothNumber 4`, abutment `ToothNumber 4` | `Implant` (Crown + Abutment), teeth `[4]`, 2 components, `TOOTH_NUMBER_CONFLICT` warning |
| `Items = Splint`, typeId `Splint1`, `ToothNumber 17` | `teSplint` | `Appliances`, subtype `Splint1`, teeth `[17]` |
| `Items = Anatomy bridge 37-35` | `18 teCrown, 19 teCrownPontic, 20 teCrown`, connector span | `Crown & Bridges` (Bridge), teeth `[18,19,20]`, 3 components |
| `Items = Anatomy bridge 24-26` | `12,13,14` | Bridge, teeth `[12,13,14]` |
| `Items = Anatomical coping 12`, `ToothNumber 7` | `teCoping` | `Crown & Bridges` (Coping), teeth `[7]` (not 12), `TOOTH_NUMBER_CONFLICT` |
| `Items = Artificial teeth … Gingiva …` | 28× `teArtificialTooth` + 28× `teGingivaFD` | `Denture`, 2 components, ONE case |

---

## 5. Reading a package out of R2

The app runs as a long-lived PM2 process with `max_memory_restart: '2G'`
(`ecosystem.config.js`) and packages can be multi-GB (CAD + scans). **Never `GetObject` the
whole archive.**

### 5.1 Range reader

```
RangeReader = (offset: number, length: number) => Promise<Buffer>
  → r2.send(new GetObjectCommand({ Bucket, Key, Range: `bytes=${offset}-${offset+length-1}` }))
```

`r2-zip.ts` `openZipFromR2(key)`:

1. `HEAD` → total size `N`.
2. Range-read the last `min(N, 65_557)` bytes → scan backwards for the EOCD signature
   (`0x06054b50`) — the exact loop in `zip.mjs:findEocd`, over a tail buffer.
3. If 32-bit `count` / `cdOffset` are saturated, follow the **ZIP64** EOCD locator
   (`0x07064b50`) with one more range read — `zip.mjs` already branches on this.
4. Range-read exactly the central directory (`[cdOffset, cdOffset + cdSize)`), walk CDH
   records → `entries[]` (`name, size, compressedSize, method, localHeaderOffset, encrypted`).
5. Per entry: range-read its 30-byte **local** header, parse *its* `nameLen`/`extraLen`
   (they can differ from the CDH), then range-read `compressedSize` bytes (use the **CDH**
   size — streamed entries leave the local sizes 0) and `inflateRawSync` (method 8) / copy
   (method 0).

### 5.2 Guards

- Only entries matching the XML filter get inflated, and only if **`size < 5 MB`** and
  **`!encrypted`**.
- Stop after `2_000` CDH records.
- Refuse to inflate if cumulative inflated bytes for one package exceed **25 MB**
  (`INFLATE_LIMIT`).
- `.3ml` archives are password-protected → never inflated; `ENCRYPTED_ENTRIES` warning.
- Entry names are only ever *matched*, never used as filesystem paths (nothing is written
  to disk). `basename()` before comparison.

### 5.2a Locating the order XML — one per zip (Q4, Option A)

From the central-directory listing, select the order XML by this rule — **in order**:

1. Collect every entry that is `*.xml`, not a directory, not encrypted, `size < 5 MB`, and
   whose basename is **not** `Materials.xml` / `SID_UserInputData.XML` (case-insensitive).
2. **Exactly one must have a basename equal to `<zipBasename>.xml`.** That is the order XML.
3. Parse it and assert `OrderList` contains **exactly one `<TDM_Item_Order>`**.

If step 2 finds **zero** candidates → `NO_ORDER_XML` (raw-scan card). If step 2 finds a
non-name-matching candidate but no exact match → `ORDER_XML_NAME_MISMATCH` **error card**.
If step 2 finds **more than one** candidate, or step 3 sees **more than one** order record →
`MULTIPLE_ORDER_XML` **error card**: *"This file contains more than one case — upload each
3Shape case as its own zip."* The importer **never** falls back to "first `.xml` that isn't
Materials/SID" (the toolkit's current `fromZip` behaviour) — that path silently drops cases.

`Materials.xml` and `SID_UserInputData.XML`, when present, are read from the same listing as
companions to the one order XML.

### 5.3 Archive asset classification (`validators/assets.ts`)

Every archive entry is inventoried into `normalized.assets[]` with its exact path and a
`kind` (spec §42):

| Path pattern | kind |
|---|---|
| `CAD/**` (`*.dcm`, `*.3ml`) | `CAD` |
| `Scans/**` (`*.dcm`) | `SCAN` |
| `3SCom/Screenshots/**` (`*.jpg`) | `SCREENSHOT` |
| `Anatomy elements/**` | `ANATOMY` |
| `External models/**` | `EXTERNAL_MODEL` |
| `OrderSource/**` (`*.3OXZ`) | `ORDER_SOURCE` |
| `Materials.xml`, `MaterialsIntegrity_*.3ml` | `MATERIAL_DEFINITION` |
| `Manufacturers.3ml` | `MANUFACTURER_DEFINITION` |
| `DentalDesignerModellingTree.3ml` | `DESIGN_TREE` |
| anything else | `OTHER` |

Then **resolve references**: for every `ModelElement.modelFilename` and every
`Scan.fileNameInXml`, try to find the matching asset; set `resolvedAssetPath` or emit
`MODEL_FILE_NOT_FOUND` / `SCAN_FILE_NOT_FOUND`. Conversely, an **empty XML `FileName` does
not mean there is no scan** — discover scans by walking `Scans/**` and attach them.

**Screenshots are not clinical scans.** Never mix `SCREENSHOT` assets into `scans[]`.

### 5.4 Assets stay in the original zip

v1 does **not** re-upload individual CAD / scan files. The whole `.zip` is the case's
`uploadedFile` (already in R2 via the chunked flow). `assets[]` records the *paths inside
that zip* for reference and future extraction. A production `fileUrl` is always the
`/api/cases/files?...` proxy URL — **never** a raw `CAD\foo.dcm` path (spec §50).

---

## 6. Mapping the domain model onto the case form

`mappers/case.ts` takes `ThreeShapeCase` and produces **two things**:

1. **Flat form fields** the carousel needs (matches today's single-case form state):

```ts
{
  category: string | null;                 // APP taxonomy (§7), null ⇒ pick manually
  subTypeData: {
    caseType?/caseType1?/caseType2?/occlusion?/arch?: string;  // only if confidently derived
    teeth: number[];                        // UNN, straight into <ToothChart system="USA">
    crownBridgeTeeth?: number[];            // Implant C&B component
    toothSystem: "USA";
    modelRequired: "yes" | "no";            // defaulted "no", flagged (§8.9)
    notes: string;                          // OrderComments + scan summary, editable
  };
}
```

2. **The audit layer** — the entire `ThreeShapeCase` under `subTypeData.threeShape`.

### 6.1 Adjustments to the toolkit's mapper

- **`clientId`** is the session client (or a subuser's parent). Drop it from review.
- **`serviceType`** — a real column (`design_only` / `design_milling` / `milling_only`).
  Leave it to the carousel: default `design_only`, show the radio only if the client has
  >1 enabled flow (mirror `AddCaseDialog`). The importer's own guess doesn't belong here.
- **`createdBy`** — set by `POST /api/cases` from the session profile. Never `OperatorName`.
- **`dueDate`** — stays null unless the client sets it. `DeliveryDate` is the lab's
  requested date, not a due date and not proof of delivery (spec §44); it lives in
  `threeShape.timestamps.deliveryDate` only.
- **`status`** — always the schema default `scan_received`. 3Shape `ProcessStatusID` →
  `threeShape.sourceStatus` only (spec §26/§45).
- **Patient name** — `cases` deliberately doesn't store it
  (`0005_remove_patient_name_from_cases.sql`). It stays inside `threeShape.patient` for
  audit; it is **not** copied into `notes` or any case column.
- **Category / sub-values** normalised to the exact strings the client form expects (§7);
  anything without a confident 1:1 match is left **blank + flagged**, never coerced.

### 6.2 On submit

The carousel builds the `POST /api/cases` array body like `handleBulkSubmit` in
`cases/page.tsx` does today, one element per **kept** draft:

```ts
{
  category: draft.category,                  // client may have corrected it
  subTypeData: {
    ...draft.subTypeData,                    // derived + client edits
    threeShape: draft.normalized,            // OBJECT key ⇒ invisible to sub-type summary (§12.2)
  },
  uploadedFile: draft.sourceZip,
  uploadedFiles: [draft.sourceZip],
  preferredTeethLibrary: "default",
  skipIfDuplicate: true,                     // opt-in to the finer rule in §9
}
```

---

## 7. Phase 0 — the taxonomy (mostly already done)

**Update (verified on disk at `a3696f3`):** the canonical hierarchy the earlier draft of
this plan asked for **already exists** — `case-creation-service-enforcement-plan.md` did the
consolidation. See `case-architecture-plan.md` for the full current model. Concretely:

- **`src/lib/case-hierarchy.ts`** is the single source, keys
  **`Crown & Bridge` · `Dentures` · `Cosmetics` · `Appliances` · `Implants` · `3D Model`**
  (exports `CASE_HIERARCHY`, `getRequiredServiceSelections`, `isFieldOptionEnabled`, …).
- **`src/lib/case-utils.ts` `CATEGORY_PREFIXES`** already has all six with matching keys
  (`CAB / CDT / CCA / CAP / CAI / 3DM`).
- `AddCaseDialog.tsx` and `client/(dashboard)/cases/page.tsx` already **import** it.
- `POST /api/cases` already validates `(category, subCategory)` against the client's price
  list via `getRequiredServiceSelections` — the importer's drafts are subject to the same
  check (a client with a sub-type disabled can't submit a draft for it).
- `cases.serviceType` **is** a real column (`design_only` / `design_milling` /
  `milling_only`), default `design_only`.
- **`3D Model` is a real category** with its own fields (`caseType1`, `caseType2`
  Hollow/Solid, `die`, `articulator`, `drainHoles`) and prefix `3DM` — no longer an open
  question.

**What is actually left for Phase 0:**

1. **The 3Shape → app map.** Add to `src/lib/case-hierarchy.ts` (or the runtime module):
   ```ts
   export const THREESHAPE_CATEGORY_MAP: Record<string, string | null> = {
     "Crown & Bridge": "Crown & Bridge",   // script already emits this spelling
     "Implants":        "Implants",
     "Appliances":      "Appliances",
     "Dentures":        "Dentures",
     "Cosmetics":       "Cosmetics",
     "3D Model":        "3D Model",
   };
   ```
   The current `scripts/.../map-to-case.mjs` `CASE_HIERARCHY` keys are already
   `Crown & Bridge / Dentures / Cosmetics / Appliances / Implants / 3D Model` — they line up
   with the canonical set, so this map is close to an identity. The real work is
   **sub-value** normalisation (§7.1).
2. **`(ops)/cases/page.tsx` still has a local `CASE_HIERARCHY` copy** (its Implants
   `caseType2` options differ). Not on the XML path, but repoint it at the shared module in
   the same cleanup so a divergent 4th copy doesn't linger.
3. **New tooth classes** `teArtificialTooth` / `teGingivaFD` — add to the runtime
   `TOOTH_CLASSES` map (§4.4); the toolkit lacks them.

### 7.1 Sub-value normalisation (script option strings → `CASE_HIERARCHY` option strings)

The importer must emit the **exact** option string each field's `<Select>` expects:

| Category | field | canonical options (must match) |
|---|---|---|
| Crown & Bridge | `caseType` | `Crown`, `Bridge`, `Cutback`, `Coping`, `Screw Retained`, `In-Lay`, `On-Lay` |
| Dentures | `caseType1` / `caseType2` | `Reference/Copy/Immediate/Full/Partial Denture` / `Upper`,`Lower`,`Both Arches` |
| Cosmetics | `caseType` | `Digital Wax Up`, `Veneers`, `Snap on Smile` |
| Appliances | `caseType1` / `occlusion` / `arch` | `Night Guards`,`Sport Guards`,`Mouth Guards`,`NTI` / `Even Occlusion`,`Custom` / `Upper`,`Lower`,`Both Arches` |
| Implants | `caseType1` / `caseType2` | `Robotic`,`Custom`,`Ti-Base` / `None`,`Crown`,`Bridge` |
| 3D Model | `caseType1` / `caseType2` / `die`/`articulator`/`drainHoles` | `Full Arch/Quad/Contact/Horse Shoe/Implant Model` / `Hollow`,`Solid` / `Yes`,`No` |

The toolkit's `map-to-case.mjs` today emits some near-misses (e.g. `Veneers` ✓ but
`Night Guards` vs the toolkit's `matchAppliance` table, `Even Occlusion` default). The
runtime `normalizers/category.ts` maps script → this table and leaves anything without a
confident hit **blank + flagged**.

**Per-category derivation rules confirmed with the product owner:**

- **Dentures — `caseType1` (Q6):** the package rarely states Full / Partial / Immediate /
  Copy / Reference. Leave the denture-type `<Select>` **blank** and flag
  `DENTURE_TYPE_UNKNOWN` for the client to choose. **Derive `caseType2` (arch)** from the
  arches of the denture tooth elements (`Upper` / `Lower` / `Both Arches`), pre-fill it,
  flag `ARCH_INFERRED`.
- **Appliances — `arch`:** derive from the splint placeholder tooth (UNN 16 → Upper, 17 →
  Lower), pre-fill, flag `ARCH_INFERRED`. `occlusion` has no source → blank + flagged.
- **`modelRequired` (Q5):** always default `"no"` + `MODEL_REQUIRED_DEFAULTED`; omit
  entirely for `3D Model`.
- **3D Model — `die` / `articulator` / `drainHoles`:** default `No` + flag; `caseType2`
  Hollow/Solid from `SID` closed-bottom when present, else blank + flag.

---

## 8. Phase 1 — the extraction endpoint

`src/app/api/cases/xml-extract/route.ts` — **read-only, one job, its own route**.

```
POST /api/cases/xml-extract
body: { files: Array<{ fileName, fileUrl, fileSize, fileType }> }   // already uploaded to R2
```

### 8.1 Handler outline

1. Auth: `supabase.auth.getUser()` → `profiles`. **`client` / `subuser` only** (mirror
   `POST /api/cases`; admin variant is future work). 401/403 otherwise.
2. Resolve `clientId` + `labName`: `client` → self; `subuser` → parent via `subUsers` (same
   as `resolveClientContext` in `upload/route.ts`).
3. Validate `files`: 1–5, each `.zip`, each `fileUrl` shaped
   `/api/cases/files?labName=<thisLab>&fileName=<name>` — reject a `fileUrl` for another lab.
4. Rebuild the R2 key server-side: `key = \`${labName}/${fileName}\`` — never trust a
   caller-supplied key/path.
5. `Promise.allSettled` over the files; each wrapped in try/catch + a soft timeout:
   `openZipFromR2(key)` → `extractPackage(...)` → `mappers/case.ts` → duplicate check (§9).
   On throw: `{ ok:false, sourceZip, error }` — never rethrow.
6. Return `{ results }`, HTTP 200 even if some failed. The UI renders per-card.
7. `logActivity({ action:'case.xml_extracted', details:{ count, failed, warningsByCode,
   requiresReviewCount } })` — no `caseId` (nothing created). Feeds §17 metrics.

### 8.2 Response contract

```ts
type ExtractResult =
  | { ok: false; sourceZip: {...}; error: string }
  | {
      ok: true;
      sourceZip: { fileName: string; fileUrl: string; fileSize: number; fileType: string };
      orderXmlName: string | null;            // null ⇒ raw-scan package, blank form
      category: string | null;                // app taxonomy
      subTypeData: {...};                     // flat form fields (§6)
      normalized: ThreeShapeCase;             // §3 — persisted verbatim on submit
      dataQuality: DataQuality;               // §11
      duplicateOf: { caseId: string; caseNumber: string | null; status: string } | null;
    };

type ExtractResponse = { results: ExtractResult[] };
```

---

## 9. Phase 2 — duplicate rule

Requirement: *"if any entry already exists with the same zip file and tooth number, then we
will not create an entry."*

### 9.1 Definition

Per **this client**, an existing case whose **earliest `case_files.fileName`**
(extension-stripped, case-insensitive — the `bulk/match/route.ts:normalizeName` rule)
equals the incoming **zip basename**, AND whose `subTypeData.teeth` set **intersects** the
incoming `subTypeData.teeth`, AND whose status is in **`ACTIVE_CASE_STATUSES`** (Q2 —
active only; a Completed / Cancelled / Rejected case with the same name does **not**
suppress a new draft). Overlap-not-exact is deliberate; keep the set operator a single
constant so it's easy to tighten later.

### 9.2 Enforced twice

- **Advisory, in `xml-extract`:** one query loads this client's active cases
  (`{caseId, caseNumber, status, subTypeData, earliestFileName}`), indexed by normalised
  name; fill `duplicateOf`.
- **Authoritative, in `POST /api/cases`:** extend the existing block (`route.ts` ~143–176).
  Today it's **all-or-nothing 409** on any filename collision. Change: when an incoming entry
  carries `skipIfDuplicate: true` (only the XML flow sets it), apply the name+tooth-overlap
  rule and **silently skip that one entry** into a new `skipped[]`; entries **without** the
  flag keep today's 409. Also dedupe **within the request** (two zips, same basename,
  overlapping teeth → keep the first).
  Response becomes `{ data: [...created], skipped: [{ fileName, teeth, existingCaseNumber }] }`
  — additive; existing callers ignore `skipped`.

### 9.3 Force-create

`duplicateOf != null` renders the "Skip" banner **checked**. Unchecking drops
`skipIfDuplicate` for that entry (subject to the normal 409 for a same-name active case —
surface that inline).

---

## 10. Phase 3 — the review carousel UI

New: `src/components/ThreeShapeImport/` — `ThreeShapeImportTab.tsx` (upload + extract),
`DraftCarousel.tsx` (`‹ 2/5 ›` shell), `DraftCaseForm.tsx` (one pre-filled form),
`NeedsReviewBadge.tsx`, `SourcePanel.tsx` (read-only "from the package" view of
`normalized`).

### 10.1 Reuse, don't re-fork, the case form

The category / sub-type / `<ToothChart>` / model-required / notes / teeth-library form is
**duplicated** across `AddCaseDialog.tsx` and `cases/page.tsx` (single + bulk-row). Extract
the shared piece into `DraftCaseForm.tsx` (`value`, `onChange`, `highlightFields: string[]`,
`disabled`) and have the carousel use it. If a full extraction is too big for this PR, build
`DraftCaseForm` from the client-page markup and file a debt ticket — **do not** add a 3rd
inline copy.

### 10.2 Behaviour

- **Upload stage:** dropzone, max 5, `.zip` only, 5 GB cap (reuse `validateFile`), per-file
  progress via `uploadFileInChunks`. "Extract" disabled until every zip is `uploaded`.
- **Extract stage:** spinner per card while `POST /api/cases/xml-extract` runs.
- **Carousel:** `‹ ›` + counter; keyboard `←/→`; a thumbnail rail
  (`zipName · category · ⚠3`). Per card:
  - `ok:false` → red, message, `[ Create blank case from this zip ]` (category unset, note
    "3Shape XML unreadable: <err>").
  - `orderXmlName == null` (raw scan) → amber, "No order file — fill everything manually".
  - normal → `DraftCaseForm` seeded from `subTypeData`; `highlightFields` =
    `dataQuality.warnings.map(w => w.field).filter(Boolean)` plus any tooth element with
    `requiresReview`. Collapsible **Needs review** list (message + resolution). Collapsible
    **From the package** panel rendering `normalized` (patient, order source, components,
    scans, assets, sourceStatus).
  - duplicate → banner + checkbox (§9.3).
- **Validate before submit:** reuse `hasAllRequiredCaseFields` per non-skipped card; block +
  jump to the first invalid card.
- **Submit:** one `POST /api/cases` array; toast `{data.length} created, {skipped.length}
  skipped`; close; `fetchCases()`.
- **Cleanup:** none (Q7). Zips uploaded for extraction that never become a case are left in
  R2; the existing `r2-retention` sweep collects orphans. Don't wire a close-without-submit
  delete.

### 10.3 Tooth chart

`subTypeData.teeth` is **UNN 1–32**, `toothSystem` is `"USA"` → straight into
`<ToothChart selected={teeth} system="USA" />`, no conversion (verified three ways in
`CASE-XML-MAPPING.md`). Implants: `teeth` = abutment UNNs, `crownBridgeTeeth` = crown/pontic
UNNs.

---

## 11. Data quality — warning codes & `requiresReview`

`validators/*` assemble `normalized.dataQuality`. The carousel drives its amber highlighting
off it, and `POST /api/cases` persists it inside `threeShape`.

```ts
type WarningCode =
  | "TOOTH_NUMBER_CONFLICT"      // Items text tooth ≠ ToothElement.ToothNumber → used ToothNumber
  | "UNKNOWN_TOOTH_CLASS"        // CacheToothTypeClass not in the normalisation map
  | "UNKNOWN_SUBTYPE"            // toothElementTypeID has no friendly resolution
  | "MODEL_FILE_NOT_FOUND"      // ModelFilename not present in the archive
  | "SCAN_FILE_NOT_FOUND"       // Scan.FileName referenced but absent
  | "PATIENT_NAME_UNAVAILABLE"  // both first & last empty
  | "CATEGORY_AMBIGUOUS"        // signals disagree; picked one, flagged
  | "MODEL_REQUIRED_DEFAULTED"  // commercial choice, not in the file (Q5 — default "no")
  | "ARCH_INFERRED"             // arch derived from tooth elements (appliances, dentures — Q6)
  | "DENTURE_TYPE_UNKNOWN"      // Full/Partial/Immediate/… not in the file → caseType1 blank (Q6)
  | "NO_ORDER_XML"              // raw-scan package → raw-scan card
  | "NO_MATERIALS_XML" | "NO_SCAN_SETTINGS"
  | "ENCRYPTED_ENTRIES"         // .3ml skipped
  | "ZIP64" | "LARGE_XML";

type ErrorCode =
  | "XML_UNREADABLE"            // not a zip / no DentalContainer / parse failure
  | "MULTIPLE_ORDER_XML"        // >1 candidate order XML, or >1 <TDM_Item_Order> (Q4 — Option A)
  | "ORDER_XML_NAME_MISMATCH"   // the sole order XML's basename ≠ the zip basename (Q4)
  | "NO_ORDER_AND_NO_MESHES"    // nothing usable in the package
  | "INFLATE_LIMIT";            // entry exceeded the 25 MB decompress ceiling
```

- Each warning: `{ code, message, resolution?, field? }`. `field` is the `subTypeData`-
  relative path so the form can highlight it.
- `errors[]` makes the draft unusable — an **error card**, not a form. Per **Q4 (Option A)**
  a zip with more than one order (either >1 candidate order XML **or** >1 `TDM_Item_Order`
  in the one XML), or whose order XML isn't named after the zip, is an error:
  *"This file contains more than one case — upload each 3Shape case as its own zip."* The
  importer never silently picks one order.
- `requiresReview = warnings.some(w => w.code in REVIEW_CODES) || errors.length > 0`.
- **Every conflict is surfaced with its resolution** — the importer is deterministic and
  auditable; it resolves conflicts in favour of structural data and *says so*, never
  silently.

Sample (spec §63):

```json
{
  "valid": true,
  "requiresReview": true,
  "warnings": [
    { "code": "TOOTH_NUMBER_CONFLICT",
      "message": "Order item references tooth 12 but ToothElement specifies tooth 7.",
      "resolution": "Used ToothElement.ToothNumber = 7.",
      "field": "teeth" }
  ],
  "errors": []
}
```

---

## 12. What you must get right — checklist

1. **Taxonomy.** Runtime `mappers/case.ts` emits only the canonical `CASE_HIERARCHY` keys
   (`Crown & Bridge` · `Dentures` · `Cosmetics` · `Appliances` · `Implants` · `3D Model`)
   and the **exact** option strings from `case-architecture-plan.md` §4 / §7.1, or `null`.
   Prove it with the §15.4 drift test.
2. **`caseNumber` stays server-assigned.** `POST /api/cases` pulls `nextval('cases_number_seq')`
   and `getCasePrefix(category)`; the payload's `caseNumber` is ignored. The
   `CATEGORY_PREFIXES` lookup already has all six canonical keys — the importer just has to
   use them (a legacy spelling like `"Implant"` would degrade to the `IMX` initials path).
3. **`threeShape` is an object, never scalars.** `renderSubTypeSummary`
   (`CaseDetailView.tsx:185`), the filters in `cases/page.tsx` (the `filtered` useMemo, the
   Export handler, the table `restoration`), the `(ops)/cases/page.tsx` mirrors, and
   `export-csv.ts:37` all build the "restoration" label from **every string value** in
   `subTypeData` minus a hard-coded skip list
   (`teeth`,`crownBridgeTeeth`,`toothSystem`,`notes`,`modelRequired`). A nested object is
   skipped by `typeof value === "string"`. Do **not** add scalar keys like
   `subTypeData.source`. Add `threeShape` to every skip list too (defence in depth).
   `CaseDetailView` also renders unknown `subTypeData` keys as generic `Label: Value` rows.
   See `case-architecture-plan.md` §10.
4. **Structured-data-first (spec §58/§59/§70).** Never infer tooth number from `Items` /
   filename / `ToothElementID` / `toothElementTypeID` when a `ToothElement` exists. Never
   infer category from filename alone. Never treat `ModelFilename` as `outputFile`,
   `ProcessStatusID` as `cases.status`, or `DeliveryDate` as proof of delivery.
5. **Never coerce IDs into UUID columns.** 3Shape `ClientID` → `threeShape.sourceIds`, the
   app resolves `clientId` from the session. `OperatorID/Name` → `threeShape.order`, never
   `designerId` / `createdBy`.
6. **Preserve raw + normalized everywhere** (spec §60): `rawClass`/`normalizedClass`,
   `rawScanType`/`normalizedScanType`, `rawMaterialName`/`materialName`,
   `validationResult`/`passed`, `scriptCategory`/`category`. Future normalisation
   improvements must not require re-importing the package.
7. **Component model, not flattening** (spec §31/§56). Denture = ONE case with
   `components:[Artificial Teeth, Gingiva]`. Crown+Abutment = ONE case, 2 components.
   Bridge keeps its per-unit classes.
8. **Unknown classes don't break the import** (spec §69): `normalizedClass:"Unknown"`,
   `requiresReview:true`, `UNKNOWN_TOOTH_CLASS` warning, logged for future mapping.
9. **`modelRequired` is a commercial choice** the file doesn't record — default `"no"`,
   `MODEL_REQUIRED_DEFAULTED` (justified: prod runs 172 "no" / 71 "yes",
   `CASE-XML-MAPPING.md`). Appliance arch expansion stays flagged (`ARCH_INFERRED`).
10. **Preserve `LinkToothElementList`, `SplitBridgeLinkList`, `CustomDataList` (public *and*
    internal), attachments.** They feed bridge topology, dentures, and audit — never discard.
11. **No whole-archive downloads** (§5): range reader only; 5 MB per-XML cap; 25 MB inflate
    ceiling; 2 000-entry scan cap; skip encrypted `.3ml`.
12. **`fileUrl` scoping.** `xml-extract` rejects a `files[].fileUrl` whose `labName` isn't
    the caller's; the R2 key is rebuilt server-side from `labName + fileName`.
13. **Per-item isolation in `xml-extract`.** It continues past a single failed package and
    reports it. Note: `POST /api/cases` today is **all-or-nothing** — the first invalid case
    400s the whole array (`case-architecture-plan.md` §8/§11.6). The `skipped[]` change (§9)
    only softens the *duplicate* case; a genuinely invalid draft still fails the batch, so
    the carousel must fully validate every kept draft before submit.
14. **Duplicate rule is opt-in** (`skipIfDuplicate`). Existing callers keep today's 409.
    `skipped[]` is additive.
15. **`serviceType` exists** — it's a real column (`design_only`/`design_milling`/
    `milling_only`, default `design_only`) and must be in the client's `enabledServiceTypes`
    or `POST /api/cases` 400s. Only send it if the client picked one; else omit and take the
    default. `dueDate` null unless the client sets it; `status` = `scan_received`.
    **The service-catalog check still applies** — a client with, e.g., `In-Lay` disabled
    can't submit an `In-Lay` draft (`getRequiredServiceSelections`).
16. **Timestamps are epoch *seconds*** (spec §43) — `unixToIso` in the toolkit already
    `* 1000`s; keep that. Output ISO UTC.
17. **Screenshots ≠ scans** (spec §41). `3SCom/Screenshots/**` → `assets` with
    `kind:"SCREENSHOT"`, never `scans[]`.
18. **Empty XML `FileName` ≠ no scan** (spec §39). Discover scans by walking `Scans/**`.
19. **Patient name stays out of `cases`** — `threeShape.patient` only.
20. **Notes are prefilled, not authoritative** — never overwrite a client edit on re-extract.
21. **UNN passthrough** — no FDI conversion anywhere; `Items` is never parsed for teeth.
22. **Redis cache** — `POST /api/cases` already calls `invalidateCasesCache(clientId)`;
    `xml-extract` writes/caches nothing.
23. **Idempotent Extract** — re-clicking re-runs against the same R2 objects and replaces
    the carousel; no accumulation.

---

## 13. Edge cases & handling

| Case | Handling | Warning |
|---|---|---|
| No order XML (raw meshes, `CN30555.zip`) | `raw-scan.ts` inventory; `category:null`, blank form; `assets[]` still populated | `NO_ORDER_XML` |
| **>1 order XML**, or **>1 `<TDM_Item_Order>`** in the one XML (Q4) | **error card** — never pick one silently: *"This file contains more than one case — upload each as its own zip"* | `MULTIPLE_ORDER_XML` (error) |
| Sole order XML's basename ≠ zip basename (Q4) | **error card**, same message — the name mismatch usually means the zip is a hand-bundled folder | `ORDER_XML_NAME_MISMATCH` (error) |
| Corrupt / not a zip (no EOCD) | error card | `XML_UNREADABLE` |
| ZIP64 | EOCD64 locator branch (ported from `zip.mjs`) | `ZIP64` |
| Encrypted `.3ml` | skipped; case still extracts from plain XML | `ENCRYPTED_ENTRIES` |
| `Items` (text) ≠ `ToothNumber` (UNN) | trust `ToothNumber`; surface both + resolution | `TOOTH_NUMBER_CONFLICT` |
| `Materials.xml` absent | fall back to raw class names; subtype confidence drops | `NO_MATERIALS_XML` |
| `SID_UserInputData.XML` absent (articulator / die / 3D model) | those fields default + flag | `NO_SCAN_SETTINGS` |
| Unknown `CacheToothTypeClass` | `Unknown` + `requiresReview`; category may fall through | `UNKNOWN_TOOTH_CLASS` |
| `teArtificialTooth` + `teGingivaFD` (denture) | ONE case, `components:[Artificial Teeth, Gingiva]`, teeth = union of artificial | — |
| Crown + Abutment same tooth | `Implant`, 2 components, `crownBridgeTeeth` set | possibly `TOOTH_NUMBER_CONFLICT` |
| Bridge via connector links | union-find over `ltConnector` → `connectorSpans`; `components` per unit | — |
| Scan with `ModelElementID`/`ToothElementID` = `_NULL_` | valid — keep, attach to `ModelJobID` | — |
| Empty `Scan.FileName` but `Scans/**` has files | attach discovered assets | — |
| `ModelFilename` not in the archive | `resolvedAssetPath:null` | `MODEL_FILE_NOT_FOUND` |
| Same zip name + overlapping teeth, active case exists | `duplicateOf` set; skipped on submit unless forced | — |
| Two uploaded zips same basename + overlapping teeth | keep first at submit; toast notes the drop | — |
| Denture: Full/Partial/Immediate/Copy/Reference not stated (Q6) | `caseType1` left **blank + flagged**; `caseType2` (arch) derived from tooth-element arches, pre-filled | `DENTURE_TYPE_UNKNOWN`, `ARCH_INFERRED` |
| `scriptCategory === "3D Model"` | maps to app category `3D Model` (real category); `die`/`articulator`/`drainHoles` default `No` + flagged; `caseType2` Hollow/Solid ← `SID` closed-bottom when present, else blank + flagged | — |
| XML > ~40 MB | O(n) tokeniser, `maxDuration=60` backstop; consider the job path | `LARGE_XML` |
| >5 zips | client caps; server rejects `files.length > 5` | — |
| Zip uploaded, dialog closed unsubmitted (Q7) | **left in R2**; `r2-retention` sweep collects it. No delete step. | — |
| Inflate exceeds 25 MB | abort that entry → error card | `INFLATE_LIMIT` (error) |

---

## 14. Security

- **AuthZ:** `client` / `subuser` only; a subuser's cases attach to the parent `clientId`.
  No cross-lab `fileUrl`.
- **Zip-bomb:** 5 MB per-XML read cap, 25 MB total inflate cap, 2 000-entry scan cap, only
  `.xml` entries ever inflated.
- **Path traversal:** entry names are matched, never used as fs paths (nothing written to
  disk); `basename()` before compare.
- **XXE / entity expansion:** `xml.ts` is **not** a real XML parser — it decodes only the
  fixed entity subset in `xml.mjs:decodeEntities` (`&lt; &gt; &amp; &quot; &apos;` +
  numeric). No external entities, no DTD, no billion-laughs surface. **Do not** swap in a
  full XML lib without re-review.
- **SSRF:** R2 access is via the app's credentialed `r2` client and a server-built key; no
  caller URL is fetched.
- **DoS:** synchronous extraction is bounded (≤5 zips + the caps + `maxDuration`).

---

## 15. Testing

### 15.1 Fixtures

`case_data/` holds **14 real cases** (5 Splint Studio, 4 Crown & Bridge incl. 3 bridges, 5
implant) + `CN30555.zip` (raw) + a Randy Oswald zip. Copy a representative subset into
`src/lib/three-shape/__tests__/fixtures/` (or guard tests behind the folder's presence).
Golden files: snapshot `extract.mjs --json` today and commit.

### 15.2 Unit — `src/lib/three-shape/`

- `xml.ts`: attributes, entity decode (`&#xA;` in `OrderComments`), mismatched closers,
  0-byte input.
- `zip.ts` + `r2-zip.ts`: EOCD scan over a tail buffer, ZIP64 branch, stored vs deflate,
  a `RangeReader` mock that **asserts the whole file is never requested**, encrypted skip,
  `INFLATE_LIMIT`.
- `extractors/*`: raw field pulls per list; `_NULL_` handling; internal CustomData kept.
- `classifiers/*` + `normalizers/*`: the authority table (§4.2); component grouping; unknown
  class → `requiresReview`; epoch-seconds → ISO.
- `validators/*`: every `WarningCode` has a triggering fixture; `MODEL_FILE_NOT_FOUND` when
  an asset is absent; `requiresReview` roll-up.

### 15.3 Regression suite (`regression.test.ts`) — all must pass

| # | Input | Expected |
|---|---|---|
| 1 | Crown + Abutment, Items tooth 15, ToothElement tooth 4 | teeth `[4]`; `TOOTH_NUMBER_CONFLICT` |
| 2 | Splint, ToothNumber 17 | `category` → Appliances (Splint) |
| 3 | Splint, ToothNumber 16 | `category` → Appliances (Splint) |
| 4 | Bridge, Items `Anatomy bridge 37-35`, teeth 18/19/20 | Bridge; `toothNumbers [18,19,20]` |
| 5 | Bridge, Items `Anatomy bridge 24-26`, teeth 12/13/14 | Bridge; `toothNumbers [12,13,14]` |
| 6 | Coping, Items `Anatomical coping 12`, ToothNumber 7 | Coping; teeth `[7]`; `TOOTH_NUMBER_CONFLICT` |
| 7 | Full denture, 28× artificial + 28× gingiva | `Denture`; `components = [Artificial Teeth, Gingiva]`; **1 case** |

### 15.4 Drift guard

One test runs `scripts/case-xml-extract` (via `tsx`) **and** `src/lib/three-shape` over
`case_data/` and asserts `category` + component tooth lists match per case. Fails CI on
divergence.

### 15.5 Integration — the route

- 3 fixtures (good / raw-scan / corrupt) → 200, `results` length 3, one `ok:false`, one
  `orderXmlName:null`.
- cross-lab `fileUrl` → 403; 6 files → 400.
- Duplicate: seed an active case (`case_files.fileName = "2238152.zip"` + overlapping teeth)
  → `duplicateOf` set; `POST /api/cases` with `skipIfDuplicate:true` → excluded from `data`,
  in `skipped`; others created. Without the flag → today's 409 still fires.

### 15.6 Manual QA

Upload all 5 Burbank zips → 5 implant drafts, `caseType2=Crown`, abutment teeth
pre-selected, "abutment material" / "model required" flagged; edit one; submit; verify 5
`CAI-####` cases, `subTypeData.threeShape.sourceIds.sourceOrderId` populated, and the case
list's sub-type summary does **not** show the order id.

---

## 16. Data model & persistence

**v1 — no migration.** The whole `ThreeShapeCase` rides in `sub_type_data jsonb` under the
object key `threeShape`. Zero schema risk; ships fast. Not independently queryable.

**v2 (deferred) — `case_imports` table** (`data-extraction.md` §25): one row per package
processed — `case_id` (nullable), `source_hash`, `container_version`, `parser_version`,
`normalized jsonb`, `data_quality jsonb`, `status`, `created_by`, `created_at`. Enables
"re-run extraction", content-hash dedupe, and analytics on which fields most need manual
fixing. Clean additive migration (`0052_case_imports.sql`); doesn't touch `cases`.

### 16.1 `parserVersion` bump policy (Q8)

Every extraction stamps **two** versions in `threeShape.source`:

- **`containerVersion`** — the 3Shape `DentalContainer@version` attribute (e.g. `2022-1`).
  Distinguishes "3Shape changed their format" from "we changed our parser".
- **`parserVersion`** — semver `MAJOR.MINOR.PATCH`, from **one** constant in
  `src/lib/three-shape/version.ts`. Bump rules:

| Bump | Trigger | Meaning for a re-import |
|---|---|---|
| **PATCH** | Bug fix that changes **no output** for already-correct inputs (tolerate a malformed attribute, fix a crash on an odd package). | Same result — re-import pointless. |
| **MINOR** | **Additive only**: new fields captured, new tooth classes mapped, new warning codes. Old inputs still yield the **same** `category` / `subTypeData` / `teeth`, just richer `threeShape`. | Safe; re-import only to enrich provenance. |
| **MAJOR** | A normalisation rule change by which the **same package could now produce a different `category`, `subTypeData`, or `teeth`** — bridge-detection heuristic, category-priority reorder, arch-expansion rule, tooth-class → sub-value remap. | A re-import can change the case — must go through human review. |

The v2 `case_imports.parser_version` stores this; a re-import job compares stored vs current
**MAJOR** to decide whether re-processing is meaningful and whether it needs sign-off.
`git tag`-style: never lower it; changelog each bump in the toolkit README.

---

## 17. Observability & rollout

- **Metric:** from `case.xml_extracted` details, chart `warningsByCode` — tells us which
  extractor rules to improve (expect `MODEL_REQUIRED_DEFAULTED`, implant sub-type,
  `CATEGORY_AMBIGUOUS`, `UNKNOWN_TOOTH_CLASS`).
- **Metric:** extract failure rate by `error` / warning code.
- **Log:** every `ok:false` with the package name and stack (server-side only).
- **Feature flag:** gate the *3Shape Import* tab behind `NEXT_PUBLIC_ENABLE_3SHAPE_IMPORT`
  or a per-client profile flag; pilot with one lab (JDE Crown / Burbank — the sample-data
  source). The endpoint can stay live (read-only, harmless).
- **Docs:** update `scripts/case-xml-extract/README.md` with the "runtime lives in
  `src/lib/three-shape`" note and the drift-guard test.

---

## 18. What the existing toolkit already does vs. gaps to close

| Requirement | `scripts/case-xml-extract/` today | Work for `src/lib/three-shape/` |
|---|---|---|
| Locate order XML in a zip | ✅ `extract.mjs` `fromZip` — **but** it silently takes the first non-Materials/SID `.xml` | replace with the strict name-match + single-order rule (§5.2a); multi-order/mismatch → error card, never silent pick |
| Minimal dependency-free XML + ZIP readers | ✅ `xml.mjs`, `zip.mjs` | port to TS; ZIP reader → `RangeReader` |
| Category priority (structural-first) | ✅ `pickCategory` | port; extend for dentures |
| Bridge detection via `ltConnector` + union-find | ✅ `parseOrder` | port as-is → `connectorSpans` |
| Splint arch markers (UNN 16→Upper, 17→Lower) | ✅ | port; keep `ARCH_INFERRED` flag |
| UNN passthrough (no FDI conversion) | ✅ verified 3 ways | keep |
| `Materials.xml` id→name resolution | ✅ `buildLookup` | port |
| `SID_UserInputData.XML` (articulator / die / closed base) | ✅ `parseScanSettings` | port |
| Epoch **seconds** → ISO | ✅ `unixToIso` (`* 1000`) | keep |
| `needsReview` / `unmapped` bags | ✅ `map-to-case.mjs` | replace with `dataQuality` + `WarningCode` enum |
| **`teArtificialTooth` / `teGingivaFD`** classes | ❌ not in `TOOTH_CLASSES` | **add** |
| **Denture component model** (1 case, not 28) | ❌ | **add** `classifiers/components.ts` |
| **Raw + normalized on every field** | partial (some raw kept) | **make systematic** across `model.ts` |
| **Full `toothElements[]` / `modelElements[]` / `modelJobs[]` in output** | partial (`units[]`, `modelElements[]`) | **expand** to the §3 shape |
| **`LinkToothElement` / `SplitBridgeLink` preserved in output** | parsed, not emitted | **emit** under `relationships` |
| **Archive asset classification + missing-file warnings** | lists file names only | **add** `validators/assets.ts` |
| **CustomData / attachments extraction** | ❌ | **add** `extractors/custom-data.ts`, `attachments.ts` |
| **Scan discovery from `Scans/**`** when XML `FileName` empty | ❌ | **add** |
| `requiresReview` roll-up flag | implicit | **explicit** in `dataQuality` |

---

## 19. Suggested PR sequence

| PR | Contents | Risk |
|---|---|---|
| 1 | **Phase 0 (small)** — add `THREESHAPE_CATEGORY_MAP` + sub-value normalisation table + `teArtificialTooth`/`teGingivaFD` to `src/lib/case-hierarchy.ts` / runtime; repoint the stray `(ops)/cases/page.tsx` local `CASE_HIERARCHY` at the shared module. Canonical hierarchy already exists. | low |
| 2 | `src/lib/three-shape/` — `model.ts`, `xml.ts`, `zip.ts`, extractors, classifiers, normalizers, validators. Unit + regression + drift tests. No wiring. | low (dead code) |
| 3 | `r2-zip.ts` + `openZipFromR2` + `validators/assets.ts` + tests. | low |
| 4 | `POST /api/cases/xml-extract` + `mappers/case.ts` + integration tests. Endpoint live, unreferenced. | low |
| 5 | `skipIfDuplicate` + `skipped[]` in `POST /api/cases` + tests. | med (shared endpoint) |
| 6 | `ThreeShapeImport/` components + the 3rd tab, behind the feature flag. | med (UI) |
| 7 | `CaseDetailView` "Imported from 3Shape" panel (renders `threeShape`); README + metrics. | low |

---

## 20. Decisions (was: open questions)

- **Q1 — `3D Model` category.** ✅ **Resolved.** Real app category (prefix `3DM`; fields
  `caseType1` / `caseType2` Hollow-Solid / `die` / `articulator` / `drainHoles`;
  `3d-model-implement-plan.md`). The toolkit's 3D-Model branch maps onto it directly.
  *Sub-question still open:* whether `SID_UserInputData.XML` reliably carries Hollow/Solid +
  die info across labs, or those fields are usually blank + flagged — assume the latter
  until sample data says otherwise.
- **Q2 — duplicate scope.** ✅ **Only active cases.** Match = zip basename + tooth **overlap**
  against this client's cases whose status is in `ACTIVE_CASE_STATUSES` (lifecycle step ≠
  `Completed`). A Completed / Cancelled / Rejected case with the same name does **not**
  suppress a new draft. Overlap-not-exact stays; keep the operator a single constant.
- **Q3 — admin path.** ✅ **Client (and subuser) only for v1.** No 3Shape Import tab in
  `AddCaseDialog`. `clientId` comes from the session (subuser → parent). An admin variant
  with a client-picker is future work.
- **Q4 — orders per zip.** ✅ **One 3Shape case per zip (Option A).** A multi-case zip is a
  user error. The extractor identifies the order XML by **name match** against the zip
  basename and asserts `OrderList` holds exactly one `TDM_Item_Order`. If a zip has a
  name mismatch, **>1** candidate order XML, or **>1** `TDM_Item_Order` → an **error card**
  (`MULTIPLE_ORDER_XML`, in `errors[]` not `warnings[]`): *"This file contains more than one
  case — upload each 3Shape case as its own zip."* **Never silently pick one.** Dedupe stays
  keyed on zip basename; carousel stays ≤5 cards. (Zero order XMLs → the raw-scan card,
  unchanged.)
- **Q5 — `modelRequired` default.** ✅ **Keep `"no"` + `MODEL_REQUIRED_DEFAULTED` flag.**
  Justified against production (172 "no" / 71 "yes", `CASE-XML-MAPPING.md`). Omitted entirely
  for category `3D Model`.
- **Q6 — denture form mapping.** ✅ **`caseType1` blank + flagged; `caseType2` (arch)
  derived.** The package rarely states Full/Partial/Immediate/Copy/Reference, so leave the
  denture-type `<Select>` empty with a `NEEDS_REVIEW` flag for the client to pick; derive
  the arch (Upper/Lower/Both Arches) from the tooth elements' arches and pre-fill
  `caseType2`, still flagged `ARCH_INFERRED`.
- **Q7 — retention of unused zips.** ✅ **No proactive cleanup.** Zips uploaded for
  extraction that never become a case are left in R2; the existing `r2-retention` sweep
  handles orphans. Drop the "best-effort `DELETE /api/cases/files` on dialog close" step
  from §10 / §12 / §13.
- **Q8 — `parserVersion` bump policy.** ✅ **Adopted** — see §17.
