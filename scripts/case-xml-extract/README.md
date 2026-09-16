# 3Shape scan → IconicConnect case

Standalone tooling that reads the dental-scanner exports in `case_data/` and
reports every field needed to create a case. **Nothing here is imported by the
app** — it is read-only analysis that lives outside `src/`.

```bash
node scripts/case-xml-extract/extract.mjs case_data                    # all cases, human report
node scripts/case-xml-extract/extract.mjs case_data --json --out o.json
node scripts/case-xml-extract/extract.mjs case_data/Cases/Burbank/2238152.zip
```

Accepts a loose order `.xml`, an extracted case folder, a `.zip` case, or any
directory holding those. No dependencies — the XML reader and ZIP reader are
in `lib/`.

**Two input formats.** Most of what the tool does applies to 3Shape
DentalContainer exports. Some labs instead upload raw scan meshes with no order
file at all (`CN30555.zip`: three STLs and nothing else). Those are recognised
and inventoried by `lib/raw-scan.mjs`, but almost nothing about the case can be
derived from them — every field is flagged for a human. Only 40 of the 243
cases in the database came from a full DentalContainer export.

Flags: `--json`, `--out <file>`, `--client-id <uuid>`, `--service-type <t>`,
`--include-patient`, `--quiet`.

---

## What the scan files actually are

Every export is a 3Shape **DentalContainer** (`version="2022-1"`) — a flat
object graph of `TDM_List_*` → `TDM_Item_*` → `<Property name value/>`.
Only six lists carry case-creation information:

| List | What it gives us |
|---|---|
| `TDM_Item_Order` | order id, patient, lab, **OrderComments**, indication summary, materials, shade, design module, scan date, delivery date |
| `TDM_Item_ModelElement` | one per manufactured part: type (`meSplint`/`meIndicationRegular`), material, CAD file, validation result |
| `TDM_Item_ToothElement` | **one per unit: `ToothNumber`, `CacheToothTypeClass`, `AbutmentKitID`** |
| `TDM_Item_Link` + `TDM_Item_LinkToothElement` | connector links → which units are joined into a bridge |
| `TDM_Item_Scan` | which scans exist (prep / antagonist / intra-oral) |
| `TDM_Item_CustomData` | scanner app + printable-order-form path |

Companion files in the same case folder:

- **`Materials.xml`** — lookup tables. Resolves `toothElementTypeID` and
  `MaterialID` into readable names (`38145_ToothElementType1012` → *"Burbank
  posterior abutment + crown"*). Optional; the extractor falls back to the
  raw class name.
- **`SID_UserInputData.XML`** — scanner/Model-Builder settings. The only
  source for articulator, die steps and model base type.
- **`PrintableOrderForm/PrintableOrderForm.html`** — human-readable summary
  (used here to verify the numbering, not parsed at runtime).
- **`*.3ml`** — password-protected 3Shape archives. **Not readable**, and
  nothing needed for case creation lives in them.

### Tooth numbering — the key finding

`ToothNumber` in the order XML is the **Universal Numbering System (1–32)**,
which is exactly what `ToothChart` stores when `toothSystem === "USA"`. So
tooth numbers pass straight through with **no conversion**.

Verified three ways: the numbers match the `Anatomy elements/UNN<n>.dcm`
filenames, they match the FDI numbers printed on `PrintableOrderForm.html`,
and `Items = "Anatomy bridge 24-26"` (FDI) lands on UNN 12–14.

The `Items` string on the order uses **FDI** — do not read teeth from it.

---

## Field-by-field mapping

Target shape is the `caseData` object posted by
`src/components/AddCaseDialog.tsx` → `POST /api/cases`.

### Derived from the file — high confidence

| Case field | Source |
|---|---|
| `category` | `CacheToothTypeClass` of the tooth elements (see rules below) |
| `caseNumber` | 3-letter prefix for the category (`CATEGORY_PREFIXES`); the server assigns the sequence |
| `subTypeData.teeth` | `ToothElement.ToothNumber` (already UNN) |
| `subTypeData.toothSystem` | always `"USA"` |
| `subTypeData.caseType` (C&B) | connector links → Bridge; `teInlay`/`teOnlay`/`teCoping`/`teVeneer` → matching sub-type; otherwise Crown |
| `subTypeData.caseType2` (Implants) | crown/pontic elements sitting over the abutment → `Crown` / `Bridge` / `None` |
| `subTypeData.crownBridgeTeeth` | tooth numbers of those crown/pontic elements |
| `subTypeData.arch` (Appliances) | splint placeholder tooth: UNN ≤16 upper, ≥17 lower |
| `subTypeData.articulator` (3D Model) | `SID_UserInputData.IsArticulatorHolderUsed` |
| `subTypeData.die` (3D Model) | `SID_UserInputData` `MainStepDie <UNN>` steps |
| `subTypeData.notes` | `Order.OrderComments` + a generated scan summary |


### Derived, but worth a glance

| Case field | How |
|---|---|
| `subTypeData.caseType1` (Implants) | abutment material: metal (Titanium/TAN/CoCr/pre-milled) → **Custom**; ceramic/PMMA on a prefabricated base → **Ti-Base** |
| `subTypeData.caseType2` (3D Model) | `SID_UserInputData.CloseBottomHole` → Solid / Hollow |
| `subTypeData.caseType1` (Appliances/Dentures) | keyword match on the indication text |
| `subTypeData.caseType` = Cutback | an *anatomical* coping — but that is 3Shape's CAD set-up wording, not necessarily what the lab ordered; always flagged |

### Not in the scan file at all — a human must supply these

| Case field | Why |
|---|---|
| `clientId` | 3Shape identifies the lab only by its own strings (`Customer`, `ManufName`, `ClientID`). Build a mapping table, or pass `--client-id`. |
| `serviceType` | Commercial choice (design only / + milling / milling only). Pass `--service-type`. |
| `preferredTeethLibrary` + library file | A client preference, not scan data. |
| `uploadedFile` / `uploadedFiles` | The `.zip` still goes through the normal chunked upload; splice the returned records in. |
| `subTypeData.occlusion` (Appliances) | Even vs Custom is not recorded anywhere. |
| `subTypeData.modelRequired` | `Order.ModelDesignModule` only means the scan carries Model Builder data, which is **not** the same as the client wanting a printed model. Verified against production: all 33 JDE Crown cases whose XML sets `mdmModelBuilder` were entered as `no`. Defaults to `no`; pass `--model-required yes`. |
| `subTypeData.drainHoles` (3D Model) | A printing option, absent from the export. |
| `caseType1 = "Robotic"` (Implants) | No marker exists — never auto-selected. |
| `caseType1` shape (3D Model) | Full Arch / Quad / Contact / Horse Shoe / Implant Model is a visual call. |
| `dueDate` | `ModelElement.DeliveryDate` is the *lab's* internal date, reported under `unmapped.requestedDeliveryDate` rather than used. |

Every one of these is listed per case under **NEEDS A HUMAN** in the report,
and under `needsReview` in the JSON, with the reason attached.

### Deliberately dropped

Patient name is present in the XML but **cases do not store it**
(`0005_remove_patient_name_from_cases.sql`). Pass `--include-patient` to keep
it in the notes if a particular workflow needs it.

---

## Category rules

Evaluated in order, first match wins (a case carries exactly one category):

1. any `teAbutment` → **Implants**
2. any denture/bar/RPD class, or `DentureDesigner`/`RemovableDesigner` → **Dentures**
3. any `teSplint` / `meSplint`, or `SplintStudio`/`ApplianceDesigner` → **Appliances**
4. any `teVeneer` / wax-up class → **Cosmetics**
5. any crown/pontic/coping/inlay/onlay class → **Crown & Bridge**
6. nothing restorative left → **3D Model**

An order containing genuinely separate jobs (say a bridge *and* an unrelated
splint) collapses to one category by this priority; check the `units` list in
the report when the indication summary looks mixed.

---

## Results on the current `case_data/` (14 cases)

| Cases | Category | Notes |
|---|---|---|
| 5 × `0856xx_*` (Splint Studio) | Appliances | arch derived from the splint placeholder tooth; appliance type + occlusion need confirming |
| 4 × `17929_*` (JDE Crown) | Crown & Bridge | 3 bridges (connectors resolved to spans 12-13-14, 18-19-20), 1 single crown |
| 5 × Burbank `22385xx` | Implants | 3 × Ti-Base, 2 × Custom, each with a Crown attached |

Only `clientId` and `serviceType` are missing on every Crown & Bridge and
Implant case; the Appliance cases additionally need appliance type and
occlusion.

---

## Files

```
extract.mjs            CLI: discovery, report, JSON
lib/xml.mjs            minimal attribute-only XML reader
lib/zip.mjs            minimal ZIP reader (stored + deflate)
lib/dental-order.mjs   DentalContainer → normalised order (units, spans, scans)
lib/map-to-case.mjs    normalised order → case payload + provenance
lib/raw-scan.mjs       mesh-only uploads: inventory, and an honest "needs a human"
db-lookup.mjs          compare against the cases really created from these files
```

`lib/map-to-case.mjs` mirrors `CASE_HIERARCHY` (`src/lib/case-hierarchy.ts`)
and `CATEGORY_PREFIXES` (`src/lib/case-utils.ts`) by hand rather than
importing them, so the app stays untouched. If the hierarchy changes, update
that file too.
