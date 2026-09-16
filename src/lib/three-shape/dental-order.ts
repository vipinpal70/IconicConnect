/**
 * 3Shape "DentalContainer" reader.
 *
 * The scanner writes a flat object graph:
 *   <Object name="OrderList" type="TDM_List_Order">
 *     <List name="Items">
 *       <Object type="TDM_Item_Order"><Property name="..." value="..."/>...
 *
 * Everything needed for case creation lives in six of those lists, plus the
 * lookup tables in the sibling `Materials.xml`.
 *
 * TypeScript port of `scripts/case-xml-extract/lib/dental-order.mjs`. Behaviour
 * is intentionally identical (drift-guard test, xml-work-plan.md §15.4). The one
 * deliberate extension: `teArtificialTooth` / `teGingivaFD` are added to
 * {@link TOOTH_CLASSES} for denture support (§18) — this changes no output on
 * the existing sample set, which has no such elements.
 */
import { parseXml, walk, type XmlNode } from './xml'

/** One `TDM_Item_*` object flattened to its `<Property name value/>` pairs. */
export type TdmRecord = Record<string, string>

/** `<Object type="TDM_Item_X">` -> `{ name: value }`. */
function itemToRecord(node: XmlNode): TdmRecord {
  const rec: TdmRecord = {}
  for (const child of node.children) {
    if (child.name === 'Property' && child.attrs.name) {
      rec[child.attrs.name] = child.attrs.value ?? ''
    }
  }
  return rec
}

/** All `TDM_Item_<kind>` records in a parsed container, in document order. */
export function collectItems(root: XmlNode, kind: string): TdmRecord[] {
  const type = `TDM_Item_${kind}`
  const out: TdmRecord[] = []
  for (const el of walk(root)) {
    if (el.name === 'Object' && el.attrs.type === type) out.push(itemToRecord(el))
  }
  return out
}

/**
 * Lookup tables are keyed by `CreatorSiteID_ItemID`, except for `Global`
 * entries which are referenced by bare `ItemID`
 * (e.g. `Abutment1`, `38145_ToothElementType1012`).
 */
function buildLookup(root: XmlNode, kind: string): Map<string, TdmRecord> {
  const map = new Map<string, TdmRecord>()
  for (const rec of collectItems(root, kind)) {
    if (!rec.ItemID) continue
    const site = rec.CreatorSiteID
    if (site && site !== 'Global') map.set(`${site}_${rec.ItemID}`, rec)
    map.set(rec.ItemID, rec)
  }
  return map
}

/* ------------------------------------------------------------------ *
 * Tooth numbering
 * ------------------------------------------------------------------ */

/**
 * `ToothNumber` in the order XML is the Universal Numbering System (1-32) —
 * confirmed against each case's `Anatomy elements/UNN<n>.dcm` files and the
 * FDI numbers printed on `PrintableOrderForm.html`. That is exactly what
 * IconicConnect's ToothChart stores when `toothSystem === "USA"`, so tooth
 * numbers pass straight through with no conversion.
 */
export const UNN_TO_FDI: Record<number, number> = {
  1: 18, 2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11,
  9: 21, 10: 22, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28,
  17: 38, 18: 37, 19: 36, 20: 35, 21: 34, 22: 33, 23: 32, 24: 31,
  25: 41, 26: 42, 27: 43, 28: 44, 29: 45, 30: 46, 31: 47, 32: 48,
}

export const archOf = (unn: number): 'Upper' | 'Lower' | null =>
  unn >= 1 && unn <= 16 ? 'Upper' : unn >= 17 && unn <= 32 ? 'Lower' : null

/** 'Upper' | 'Lower' | 'Both Arches' | null */
export function archesOf(teeth: Array<number | null>): 'Upper' | 'Lower' | 'Both Arches' | null {
  const set = new Set(teeth.map((t) => (t == null ? null : archOf(t))).filter(Boolean))
  if (set.size === 0) return null
  if (set.size === 2) return 'Both Arches'
  return [...set][0] as 'Upper' | 'Lower'
}

const range = (a: number, b: number): number[] =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i)

export const fullArch = (arch: string): number[] =>
  arch === 'Upper' ? range(1, 16) : arch === 'Lower' ? range(17, 32) : range(1, 32)

/* ------------------------------------------------------------------ *
 * Indication vocabulary
 * ------------------------------------------------------------------ */

export interface ToothClassInfo {
  label: string
  group: string
}

/**
 * `CacheToothTypeClass` -> what the unit is, and which IconicConnect family
 * it belongs to. `group` is what the category rules key off; `label` is
 * for the human-readable report.
 */
export const TOOTH_CLASSES: Record<string, ToothClassInfo> = {
  teCrown:              { label: 'Crown',              group: 'crown' },
  teCrownPontic:        { label: 'Pontic (crown)',     group: 'pontic' },
  tePontic:             { label: 'Pontic',             group: 'pontic' },
  teCoping:             { label: 'Coping',             group: 'coping' },
  teCopingPontic:       { label: 'Pontic (coping)',    group: 'pontic' },
  teAnatomicalCoping:   { label: 'Anatomical coping',  group: 'cutback' },
  teInlay:              { label: 'Inlay',              group: 'inlay' },
  teOnlay:              { label: 'Onlay',              group: 'onlay' },
  teVeneer:             { label: 'Veneer',             group: 'veneer' },
  teAbutment:           { label: 'Abutment',           group: 'abutment' },
  teAbutmentPontic:     { label: 'Abutment pontic',    group: 'pontic' },
  teScrewRetained:      { label: 'Screw-retained crown', group: 'screwRetained' },
  teCrownScrewRetained: { label: 'Screw-retained crown', group: 'screwRetained' },
  teTemporaryCrown:     { label: 'Temporary crown',    group: 'crown' },
  teTemporaryCrownPontic: { label: 'Temporary pontic', group: 'pontic' },
  teTemporaryPontic:    { label: 'Temporary pontic',   group: 'pontic' },
  teProvisional:        { label: 'Provisional crown',  group: 'crown' },
  teProvisionalPontic:  { label: 'Provisional pontic', group: 'pontic' },
  tePostAndCore:        { label: 'Post and core',      group: 'crown' },
  teTelescope:          { label: 'Telescope',          group: 'coping' },
  teWaxup:              { label: 'Wax-up',             group: 'waxup' },
  teWaxupPontic:        { label: 'Wax-up pontic',      group: 'waxup' },
  teSplint:             { label: 'Splint',             group: 'splint' },
  teBar:                { label: 'Bar',                group: 'denture' },
  teBarSegment:         { label: 'Bar segment',        group: 'denture' },
  teAttachment:         { label: 'Attachment',         group: 'denture' },
  teDenture:            { label: 'Denture',            group: 'denture' },
  teDentureTooth:       { label: 'Denture tooth',      group: 'denture' },
  teRPD:                { label: 'RPD framework',      group: 'denture' },
  teRPDFrameWork:       { label: 'RPD framework',      group: 'denture' },
  teModel:              { label: 'Model',              group: 'model' },
  teScanBody:           { label: 'Scan body',          group: 'other' },
  // --- added for denture support (xml-work-plan.md §18) ---
  teArtificialTooth:    { label: 'Artificial tooth',   group: 'denture' },
  teGingivaFD:          { label: 'Gingiva',            group: 'denture' },
}

/** `ModelElementType` values that identify the job without any tooth element. */
export const MODEL_ELEMENT_TYPES: Record<string, string> = {
  meIndicationRegular: 'Restoration',
  meSplint: 'Splint',
  meModel: 'Physical/printed model',
  meDenture: 'Denture',
  meOrthoAppliance: 'Ortho appliance',
  meSurgicalGuide: 'Surgical guide',
  meTray: 'Impression tray',
}

export const SCAN_TYPES: Record<string, string> = {
  stPreperation: 'Preparation (model scan)',
  stPreparationIntraOral: 'Preparation (intra-oral)',
  stAntagonistModel: 'Antagonist (model scan)',
  stAntagonistIntraOral: 'Antagonist (intra-oral)',
  stOcclusion: 'Bite / occlusion',
  stGingivaMask: 'Gingiva mask',
  stImplantModel: 'Implant model',
  stWaxup: 'Wax-up',
  stPreOperational: 'Pre-operational',
  stGenericPrePrep: 'Pre-preparation (generic)',
  stEmergence: 'Emergence profile',
  stImpression: 'Impression',
}

const DESIGN_MODULES: Record<string, string> = {
  DentalDesigner: 'Restorative (Dental Designer)',
  SplintStudio: 'Splint Studio',
  DentureDesigner: 'Denture Designer',
  RemovableDesigner: 'Removable (RPD) Designer',
  ImplantStudio: 'Implant Studio',
  OrthoAnalyzer: 'Ortho Analyzer',
  ApplianceDesigner: 'Appliance Designer',
  ModelBuilder: 'Model Builder',
}

/* ------------------------------------------------------------------ *
 * Container parsing
 * ------------------------------------------------------------------ */

export interface ParsedUnit {
  unn: number | null
  fdi: number | null
  arch: 'Upper' | 'Lower' | null
  toothClass: string
  group: string
  indication: string
  indicationTypeId: string | null
  anatomical: boolean
  postAndCore: boolean
  implantKit: string | null
  material: string | null
  materialId: string | null
  materialName: string | null
  shade: string | null
  modelElementType: string | null
  cadFile: string | null
  validation: string | null
  toothElementId: string
  modelElementId: string
}

export interface ParsedOrderMeta {
  orderId: string | null
  externalOrderId: string | null
  numericOrderId: string | null
  clientOrderNo: string | null
  patientName: string | null
  patientRef: string | null
  comments: string
  itemsSummary: string
  customer: string | null
  manufacturer: string | null
  scannerClientId: string | null
  operator: string | null
  priority: string | null
  designModule: string | null
  designModuleLabel: string | null
  modelDesignModule: string | null
  scanModule: string | null
  createdFromApp: string | null
  scanSource: string | null
  materialsSummary: string | null
  shade: string | null
  scanDate: string | null
  deliveryDate: string | null
  createDate: string | null
}

export interface ParsedModelElement {
  id: string
  items: string | null
  type: string | null
  typeLabel: string | null
  material: string | null
  cadFile: string | null
  validation: string | null
  volumeMm3: number | null
  heightMm: number | null
}

export interface ParsedScan {
  id: string
  type: string
  label: string
  date: string | null
}

export interface ParsedCustomDatum {
  fieldId: string
  value: string
  kind: string
}

export interface ParsedOrder {
  order: ParsedOrderMeta
  units: ParsedUnit[]
  connectorGroups: number[][]
  hasConnector: boolean
  modelElements: ParsedModelElement[]
  scans: ParsedScan[]
  customData: ParsedCustomDatum[]
  /** Raw records kept for the domain-model assembly step (not in the .mjs). */
  raw: {
    order: TdmRecord
    modelElements: TdmRecord[]
    toothElements: TdmRecord[]
    links: TdmRecord[]
    linkToothElements: TdmRecord[]
    scans: TdmRecord[]
    customData: TdmRecord[]
    modelJobs: TdmRecord[]
    splitBridgeLinks: TdmRecord[]
    attachments: TdmRecord[]
    containerVersion: string | null
  }
  lookups: {
    toothTypes: Map<string, TdmRecord>
    materials: Map<string, TdmRecord>
    linkTypes: Map<string, TdmRecord>
    colors: Map<string, TdmRecord>
  }
}

/**
 * Parse an order XML (plus optional `Materials.xml` for name resolution) into
 * a normalised order: one `units[]` entry per restoration/appliance element,
 * with its tooth number, indication and material already resolved.
 */
export function parseOrder(orderXmlText: string, materialsXmlText: string | null = null): ParsedOrder {
  const root = parseXml(orderXmlText)

  const containerNode = root.children.find((c) => c.name === 'DentalContainer')
  const containerVersion = containerNode?.attrs.version ?? null

  const order: TdmRecord = collectItems(root, 'Order')[0] ?? {}
  const modelElements = collectItems(root, 'ModelElement')
  const toothElements = collectItems(root, 'ToothElement')
  const links = collectItems(root, 'Link')
  const linkToothElements = collectItems(root, 'LinkToothElement')
  const scans = collectItems(root, 'Scan')
  const customData = collectItems(root, 'CustomData')
  const modelJobs = collectItems(root, 'ModelJob')
  const splitBridgeLinks = collectItems(root, 'SplitBridgeLink')
  const attachments = [
    ...collectItems(root, 'OrderExchangeAttachment'),
    ...collectItems(root, 'Attachment'),
  ]

  let toothTypes = new Map<string, TdmRecord>()
  let materials = new Map<string, TdmRecord>()
  let linkTypes = new Map<string, TdmRecord>()
  let colors = new Map<string, TdmRecord>()
  if (materialsXmlText) {
    const mats = parseXml(materialsXmlText)
    toothTypes = buildLookup(mats, 'ToothElementType')
    materials = buildLookup(mats, 'Material')
    linkTypes = buildLookup(mats, 'LinkType')
    colors = buildLookup(mats, 'Color')
  }

  const modelById = new Map(modelElements.map((m) => [m.ModelElementID, m]))

  const units: ParsedUnit[] = toothElements.map((te) => {
    const model = modelById.get(te.ModelElementID) ?? ({} as TdmRecord)
    const cls = te.CacheToothTypeClass || ''
    const known = TOOTH_CLASSES[cls]
    const typeRec = te.toothElementTypeID ? toothTypes.get(te.toothElementTypeID) : undefined
    const unn = Number(te.ToothNumber) || null
    return {
      unn,
      fdi: unn ? UNN_TO_FDI[unn] ?? null : null,
      arch: unn ? archOf(unn) : null,
      toothClass: cls,
      group: known?.group ?? 'unknown',
      indication: typeRec?.Name || known?.label || cls || 'Unknown',
      indicationTypeId: te.toothElementTypeID || null,
      anatomical: te.Anatomical === 'True',
      postAndCore: te.PostAndCore === 'True',
      implantKit: te.AbutmentKitID || null,
      material: model.CacheMaterialName || null,
      materialId: model.MaterialID || null,
      materialName: (model.MaterialID ? materials.get(model.MaterialID)?.Name : null) ?? null,
      shade: model.CacheColor || order.CacheColor || null,
      modelElementType: model.ModelElementType || null,
      cadFile: model.ModelFilename || null,
      validation: model.ValidationResult || null,
      toothElementId: te.ToothElementID,
      modelElementId: te.ModelElementID,
    }
  })

  // Bridges: a connector link joins two tooth elements. Group the connected
  // teeth into spans so "3-unit bridge 12-14" is recoverable.
  const linkById = new Map(links.map((l) => [l.LinkID, l]))
  const connectorGroups: number[][] = []
  const parent = new Map<string, string>()
  const findRoot = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!)
      x = parent.get(x)!
    }
    return x
  }
  for (const te of toothElements) parent.set(te.ToothElementID, te.ToothElementID)
  let hasConnector = false
  for (const lte of linkToothElements) {
    const link = linkById.get(lte.LinkID)
    if (!link) continue
    if (link.CacheLinkTypeClass === 'ltConnector') hasConnector = true
    const peers = linkToothElements.filter((o) => o.LinkID === lte.LinkID)
    for (const peer of peers) {
      if (!parent.has(lte.ToothElementID) || !parent.has(peer.ToothElementID)) continue
      parent.set(findRoot(lte.ToothElementID), findRoot(peer.ToothElementID))
    }
  }
  if (linkToothElements.length) {
    const byRoot = new Map<string, Array<number | null>>()
    for (const te of toothElements) {
      const r = findRoot(te.ToothElementID)
      if (!byRoot.has(r)) byRoot.set(r, [])
      byRoot.get(r)!.push(Number(te.ToothNumber) || null)
    }
    for (const teeth of byRoot.values()) {
      if (teeth.length > 1) {
        connectorGroups.push((teeth.filter(Boolean) as number[]).sort((a, b) => a - b))
      }
    }
  }

  const patientName =
    [order.Patient_FirstName, order.Patient_LastName].filter(Boolean).join(' ').trim() || null

  return {
    order: {
      orderId: order.IntOrderID || null,
      externalOrderId: order.ExtOrderID || null,
      numericOrderId: order.NumOrderID || null,
      clientOrderNo: order.ClientOrderNo || null,
      patientName,
      patientRef: order.Patient_RefNo || null,
      comments: order.OrderComments || '',
      itemsSummary: order.Items || '',
      customer: order.Customer || null,
      manufacturer: order.ManufName || null,
      scannerClientId: order.ClientID || null,
      operator: order.OperatorName || null,
      priority: order.OrderImportanceID || null,
      designModule: order.DesignModuleID || null,
      designModuleLabel: DESIGN_MODULES[order.DesignModuleID] ?? order.DesignModuleID ?? null,
      modelDesignModule: order.ModelDesignModule || null,
      scanModule: order.ScanModuleID || null,
      createdFromApp: order.CreatedFromApp || null,
      scanSource: order.ScanSource || null,
      materialsSummary: order.CacheMaterialName || null,
      shade: order.CacheColor || null,
      scanDate: unixToIso(order.CacheMaxScanDate),
      deliveryDate: unixToIso(modelElements[0]?.DeliveryDate),
      createDate: unixToIso(modelElements[0]?.CreateDate),
    },
    units,
    connectorGroups,
    hasConnector,
    modelElements: modelElements.map((m) => ({
      id: m.ModelElementID,
      items: m.Items || null,
      type: m.ModelElementType || null,
      typeLabel: MODEL_ELEMENT_TYPES[m.ModelElementType] ?? m.ModelElementType ?? null,
      material: m.CacheMaterialName || null,
      cadFile: m.ModelFilename || null,
      validation: m.ValidationResult || null,
      volumeMm3: m.ModelVolume ? Number(m.ModelVolume) : null,
      heightMm: m.ModelHeight ? Number(m.ModelHeight) : null,
    })),
    scans: scans.map((s) => ({
      id: s.ScanID,
      type: s.ScanType,
      label: SCAN_TYPES[s.ScanType] ?? s.ScanType,
      date: unixToIso(s.ScanDate),
    })),
    customData: customData.map((c) => ({ fieldId: c.FieldID, value: c.Value, kind: c.Kind })),
    raw: {
      order,
      modelElements,
      toothElements,
      links,
      linkToothElements,
      scans,
      customData,
      modelJobs,
      splitBridgeLinks,
      attachments,
      containerVersion,
    },
    lookups: { toothTypes, materials, linkTypes, colors },
  }
}

/** Count of distinct `<TDM_Item_Order>` records — Q4 asserts this is exactly 1. */
export function countOrderRecords(orderXmlText: string): number {
  return collectItems(parseXml(orderXmlText), 'Order').length
}

export function unixToIso(value: string | number | null | undefined): string | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

/* ------------------------------------------------------------------ *
 * SID_UserInputData.XML — scan/model-builder settings
 * ------------------------------------------------------------------ */

export interface ScanSettings {
  articulatorUsed: boolean | null
  occlusionOptimised: boolean | null
  /** Model Builder closes the base underside for a solid model; open = hollow. */
  closedBottom: boolean | null
  dieTeeth: number[]
  hasGingivalMask: boolean
  hasMultiDie: boolean
  namespaces: string[]
  booleans: Record<string, boolean>
}

/**
 * Pulls the handful of scanner settings that map onto 3D Model case inputs.
 * The file is a Duco data store: `<DataReference Id="X"><Data><Content Value="..."/>`.
 */
export function parseScanSettings(sidXmlText: string | null | undefined): ScanSettings | null {
  if (!sidXmlText) return null
  const root = parseXml(sidXmlText)

  const bools = new Map<string, boolean>()
  const dieTeeth = new Set<number>()
  const namespaces = new Set<string>()

  for (const el of walk(root)) {
    if (el.name === 'DataReference' && el.attrs.Id) {
      const content = el.children
        .find((c) => c.name === 'Data')
        ?.children.find((c) => c.name === 'Content')
      const value = content?.attrs.Value
      if (value === 'True' || value === 'False') bools.set(el.attrs.Id, value === 'True')
    }
    if (el.name === 'NameSpace' && el.attrs.Id) {
      namespaces.add(el.attrs.Id)
      const die = /^MainStepDie\s+(\d+)$/.exec(el.attrs.Id)
      if (die) dieTeeth.add(Number(die[1]))
    }
  }

  return {
    articulatorUsed: bools.get('IsArticulatorHolderUsed') ?? null,
    occlusionOptimised: bools.get('IsOcclusionOptimizationUsed') ?? null,
    closedBottom: bools.get('CloseBottomHole') ?? null,
    dieTeeth: [...dieTeeth].sort((a, b) => a - b),
    hasGingivalMask: [...namespaces].some((n) => /GingivalMask/i.test(n)),
    hasMultiDie: [...namespaces].some((n) => /MultiDie/i.test(n)),
    namespaces: [...namespaces],
    booleans: Object.fromEntries(bools),
  }
}
