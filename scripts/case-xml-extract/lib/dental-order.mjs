/**
 * 3Shape "DentalContainer" reader.
 *
 * The scanner writes a flat object graph:
 *   <Object name="OrderList" type="TDM_List_Order">
 *     <List name="Items">
 *       <Object type="TDM_Item_Order"><Property name="..." value="..."/>...
 *
 * Everything we need for case creation lives in six of those lists, plus the
 * lookup tables in the sibling `Materials.xml`.
 */
import { parseXml, walk } from './xml.mjs'

/** `<Object type="TDM_Item_X">` -> `{ name: value }`. */
function itemToRecord(node) {
  const rec = {}
  for (const child of node.children) {
    if (child.name === 'Property' && child.attrs.name) {
      rec[child.attrs.name] = child.attrs.value ?? ''
    }
  }
  return rec
}

/** All `TDM_Item_<kind>` records in a parsed container, in document order. */
export function collectItems(root, kind) {
  const type = `TDM_Item_${kind}`
  const out = []
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
function buildLookup(root, kind) {
  const map = new Map()
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
export const UNN_TO_FDI = {
  1: 18, 2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11,
  9: 21, 10: 22, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28,
  17: 38, 18: 37, 19: 36, 20: 35, 21: 34, 22: 33, 23: 32, 24: 31,
  25: 41, 26: 42, 27: 43, 28: 44, 29: 45, 30: 46, 31: 47, 32: 48,
}

export const archOf = (unn) => (unn >= 1 && unn <= 16 ? 'Upper' : unn >= 17 && unn <= 32 ? 'Lower' : null)

/** 'Upper' | 'Lower' | 'Both Arches' | null */
export function archesOf(teeth) {
  const set = new Set(teeth.map(archOf).filter(Boolean))
  if (set.size === 0) return null
  if (set.size === 2) return 'Both Arches'
  return [...set][0]
}

export const fullArch = (arch) =>
  arch === 'Upper' ? range(1, 16) : arch === 'Lower' ? range(17, 32) : range(1, 32)

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/* ------------------------------------------------------------------ *
 * Indication vocabulary
 * ------------------------------------------------------------------ */

/**
 * `CacheToothTypeClass` -> what the unit is, and which IconicConnect family
 * it belongs to. `group` is what the category rules below key off; `label` is
 * for the human-readable report.
 */
export const TOOTH_CLASSES = {
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
}

/** `ModelElementType` values that identify the job without any tooth element. */
export const MODEL_ELEMENT_TYPES = {
  meIndicationRegular: 'Restoration',
  meSplint: 'Splint',
  meModel: 'Physical/printed model',
  meDenture: 'Denture',
  meOrthoAppliance: 'Ortho appliance',
  meSurgicalGuide: 'Surgical guide',
  meTray: 'Impression tray',
}

export const SCAN_TYPES = {
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

const DESIGN_MODULES = {
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

/**
 * Parse an order XML (plus optional `Materials.xml` for name resolution) into
 * a normalised order: one `units[]` entry per restoration/appliance element,
 * with its tooth number, indication and material already resolved.
 */
export function parseOrder(orderXmlText, materialsXmlText = null) {
  const root = parseXml(orderXmlText)

  const order = collectItems(root, 'Order')[0] ?? {}
  const modelElements = collectItems(root, 'ModelElement')
  const toothElements = collectItems(root, 'ToothElement')
  const links = collectItems(root, 'Link')
  const linkToothElements = collectItems(root, 'LinkToothElement')
  const scans = collectItems(root, 'Scan')
  const customData = collectItems(root, 'CustomData')

  let toothTypes = new Map()
  let materials = new Map()
  let linkTypes = new Map()
  let colors = new Map()
  if (materialsXmlText) {
    const mats = parseXml(materialsXmlText)
    toothTypes = buildLookup(mats, 'ToothElementType')
    materials = buildLookup(mats, 'Material')
    linkTypes = buildLookup(mats, 'LinkType')
    colors = buildLookup(mats, 'Color')
  }

  const modelById = new Map(modelElements.map((m) => [m.ModelElementID, m]))

  const units = toothElements.map((te) => {
    const model = modelById.get(te.ModelElementID) ?? {}
    const cls = te.CacheToothTypeClass || ''
    const known = TOOTH_CLASSES[cls]
    const typeRec = toothTypes.get(te.toothElementTypeID)
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
      materialName: materials.get(model.MaterialID)?.Name ?? null,
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
  const connectorGroups = []
  const parent = new Map()
  const findRoot = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
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
    const byRoot = new Map()
    for (const te of toothElements) {
      const r = findRoot(te.ToothElementID)
      if (!byRoot.has(r)) byRoot.set(r, [])
      byRoot.get(r).push(Number(te.ToothNumber) || null)
    }
    for (const teeth of byRoot.values()) {
      if (teeth.length > 1) connectorGroups.push(teeth.filter(Boolean).sort((a, b) => a - b))
    }
  }

  const patientName = [order.Patient_FirstName, order.Patient_LastName]
    .filter(Boolean).join(' ').trim() || null

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
    lookups: { toothTypes, materials, linkTypes, colors },
  }
}

function unixToIso(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

/* ------------------------------------------------------------------ *
 * SID_UserInputData.XML — scan/model-builder settings
 * ------------------------------------------------------------------ */

/**
 * Pulls the handful of scanner settings that map onto 3D Model case inputs.
 * The file is a Duco data store: `<DataReference Id="X"><Data><Content Value="..."/>`.
 */
export function parseScanSettings(sidXmlText) {
  if (!sidXmlText) return null
  const root = parseXml(sidXmlText)

  const bools = new Map()
  const dieTeeth = new Set()
  const namespaces = new Set()

  for (const el of walk(root)) {
    if (el.name === 'DataReference' && el.attrs.Id) {
      const content = el.children.find((c) => c.name === 'Data')?.children.find((c) => c.name === 'Content')
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
    // Model Builder closes the base underside for a solid model; an open
    // bottom is the hollow print.
    closedBottom: bools.get('CloseBottomHole') ?? null,
    dieTeeth: [...dieTeeth].sort((a, b) => a - b),
    hasGingivalMask: [...namespaces].some((n) => /GingivalMask/i.test(n)),
    hasMultiDie: [...namespaces].some((n) => /MultiDie/i.test(n)),
    namespaces: [...namespaces],
    booleans: Object.fromEntries(bools),
  }
}
