/**
 * 3Shape order -> IconicConnect case payload.
 *
 * Mirrors, but never imports from, the app:
 *   - categories/fields: src/lib/case-hierarchy.ts  (CASE_HIERARCHY)
 *   - payload shape:     src/components/AddCaseDialog.tsx  (handleSubmit)
 *   - case-number prefix: src/lib/case-utils.ts  (CATEGORY_PREFIXES)
 * Keep this file in sync by hand if the hierarchy changes — that is the price
 * of leaving the main codebase untouched.
 *
 * Every derived field records where it came from and how sure we are, because
 * a scan file simply does not carry some of what the case form asks for
 * (service type, occlusion style, drain holes, "Robotic" implants).
 */
import { archesOf, fullArch } from './dental-order.mjs'

/** Mirrors CASE_HIERARCHY in src/lib/case-hierarchy.ts. */
export const CASE_HIERARCHY = {
  'Crown & Bridge': ['caseType'],
  Dentures: ['caseType1', 'caseType2'],
  Cosmetics: ['caseType'],
  Appliances: ['caseType1', 'occlusion', 'arch'],
  Implants: ['caseType1', 'caseType2'],
  '3D Model': ['caseType1', 'caseType2', 'articulator', 'drainHoles', 'die'],
}

/** Mirrors CATEGORY_PREFIXES in src/lib/case-utils.ts. */
export const CATEGORY_PREFIXES = {
  'Crown & Bridge': 'CAB',
  Dentures: 'CDT',
  Cosmetics: 'CCA',
  Appliances: 'CAP',
  Implants: 'CAI',
  '3D Model': '3DM',
}

const CONFIDENCE = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', MANUAL: 'manual' }

/** Abutment material keywords that mean a milled *custom* abutment. */
const METAL_ABUTMENT = /titan|\bti\b|\btan\b|cocr|co-cr|chrom|pre[-_ ]?milled|preface|\bau\b|gold/i
/** …versus a ceramic suprastructure bonded onto a prefabricated Ti base. */
const CERAMIC_ABUTMENT = /zirk|zirc|ceram|emax|e\.max|lithium|pmma|wax|peek|hybrid/i

export function mapOrderToCase(parsed, scanSettings = null, options = {}) {
  const { order, units, connectorGroups, hasConnector, modelElements, scans } = parsed
  const notes = []          // human-facing review notes
  const provenance = {}     // field -> { value, source, confidence }

  const record = (field, value, source, confidence) => {
    provenance[field] = { value, source, confidence }
    if (confidence === CONFIDENCE.MANUAL || confidence === CONFIDENCE.LOW) {
      notes.push(`${field}: ${JSON.stringify(value)} — ${source}`)
    }
    return value
  }

  const groups = new Set(units.map((u) => u.group))
  const has = (g) => groups.has(g)
  const unitsIn = (...g) => units.filter((u) => g.includes(u.group))
  const teethOf = (list) => [...new Set(list.map((u) => u.unn).filter(Boolean))].sort((a, b) => a - b)
  const indicationText = [order.itemsSummary, ...units.map((u) => u.indication)].join(' | ')
  const spanning = connectorGroups.some((g) => g.length > 1)

  const category = pickCategory({ has, order, units, modelElements, scanSettings })
  const subTypeData = {}

  /* ---------------- category-specific fields ---------------- */

  if (category === 'Implants') {
    const abutments = unitsIn('abutment')
    const supra = unitsIn('crown', 'pontic', 'coping', 'screwRetained')

    const kitMaterial = abutments.map((a) => `${a.material ?? ''} ${a.implantKit ?? ''}`).join(' ')
    let subType, subTypeSource, subTypeConf
    if (METAL_ABUTMENT.test(kitMaterial) && !CERAMIC_ABUTMENT.test(kitMaterial)) {
      subType = 'Custom'
      subTypeSource = `abutment milled from metal (${abutments[0]?.material ?? 'unknown'})`
      subTypeConf = CONFIDENCE.MEDIUM
    } else if (CERAMIC_ABUTMENT.test(kitMaterial)) {
      subType = 'Ti-Base'
      subTypeSource = `ceramic/PMMA suprastructure on a prefabricated base (${abutments[0]?.material ?? 'unknown'})`
      subTypeConf = CONFIDENCE.MEDIUM
    } else {
      subType = 'Custom'
      subTypeSource = 'abutment material inconclusive — defaulted; "Robotic" is never inferable from a scan file'
      subTypeConf = CONFIDENCE.MANUAL
    }
    subTypeData.caseType1 = record('subTypeData.caseType1', subType, subTypeSource, subTypeConf)

    let attached = 'None', attachedSource = 'no crown/bridge element on the implant'
    if (supra.length) {
      attached = spanning || has('pontic') ? 'Bridge' : 'Crown'
      attachedSource = spanning || has('pontic')
        ? `${supra.length} connected units (${connectorGroups.map((g) => g.join('-')).join(', ')})`
        : 'single crown over the abutment'
    }
    subTypeData.caseType2 = record('subTypeData.caseType2', attached, attachedSource, supra.length ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM)

    subTypeData.teeth = record('subTypeData.teeth', teethOf(abutments), 'ToothNumber of each teAbutment element (UNN)', CONFIDENCE.HIGH)
    if (attached !== 'None') {
      subTypeData.crownBridgeTeeth = record('subTypeData.crownBridgeTeeth', teethOf(supra), 'ToothNumber of each crown/pontic element (UNN)', CONFIDENCE.HIGH)
    }
  } else if (category === 'Crown & Bridge') {
    let caseType, source, conf = CONFIDENCE.HIGH
    if (has('screwRetained') || (/screw[\s_-]?(access|retain)/i.test(order.comments) && has('abutment'))) {
      caseType = 'Screw Retained'; source = 'screw-retained tooth class / screw-access note in OrderComments'
      conf = has('screwRetained') ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM
    } else if (has('inlay')) { caseType = 'In-Lay'; source = 'teInlay element' }
    else if (has('onlay')) { caseType = 'On-Lay'; source = 'teOnlay element' }
    else if (has('cutback') || unitsIn('coping').some((u) => u.anatomical)) {
      // 3Shape's "Anatomical coping" describes how the technician set the job up
      // in CAD, not what the lab ordered. Seen in production on CAB-0271, whose
      // brief was "design 33,32,31,41,42,43 FCZ crowns" — a human entered Crown,
      // not Cutback. Cutback is the closest structural read, but Coping and
      // full-contour Crown are both live options, so this always goes to a human.
      caseType = 'Cutback'
      source = "anatomical coping element — that is 3Shape's CAD set-up wording; the lab may have ordered Coping or a full-contour Crown instead"
      conf = CONFIDENCE.MANUAL
    } else if (has('coping')) { caseType = 'Coping'; source = 'teCoping element' }
    else if (spanning || has('pontic') || /bridge/i.test(indicationText)) {
      caseType = 'Bridge'
      source = spanning
        ? `connector links joining ${connectorGroups.map((g) => g.join('-')).join(', ')}`
        : `pontic element / "${order.itemsSummary}"`
    } else { caseType = 'Crown'; source = 'single unconnected crown element(s)' }
    subTypeData.caseType = record('subTypeData.caseType', caseType, source, conf)
    subTypeData.teeth = record('subTypeData.teeth', teethOf(units), 'ToothNumber of each tooth element (UNN)', CONFIDENCE.HIGH)
  } else if (category === 'Cosmetics') {
    const caseType = has('veneer') ? 'Veneers' : 'Digital Wax Up'
    subTypeData.caseType = record('subTypeData.caseType', caseType,
      has('veneer') ? 'teVeneer element' : 'wax-up element / design module', CONFIDENCE.MEDIUM)
    subTypeData.teeth = record('subTypeData.teeth', teethOf(units), 'ToothNumber of each tooth element (UNN)', CONFIDENCE.HIGH)
  } else if (category === 'Appliances') {
    const appliance = matchAppliance(indicationText)
    subTypeData.caseType1 = record('subTypeData.caseType1', appliance.value, appliance.source, appliance.confidence)
    subTypeData.occlusion = record('subTypeData.occlusion', 'Even Occlusion',
      'not represented in the scan file — defaulted, confirm with the lab', CONFIDENCE.MANUAL)

    // A splint element carries one placeholder tooth per arch it covers
    // (UNN 16 = upper, UNN 17 = lower), not a real tooth selection.
    const markers = teethOf(units)
    const arch = archesOf(markers) ?? 'Both Arches'
    subTypeData.arch = record('subTypeData.arch', arch, `splint placeholder tooth ${markers.join(', ')} (UNN)`, CONFIDENCE.MEDIUM)
    subTypeData.teeth = record('subTypeData.teeth', fullArch(arch),
      `appliance covers the ${arch.toLowerCase()} — expanded from placeholder tooth ${markers.join(', ')}`, CONFIDENCE.MEDIUM)
  } else if (category === 'Dentures') {
    const denture = matchDenture(indicationText, units)
    subTypeData.caseType1 = record('subTypeData.caseType1', denture.value, denture.source, denture.confidence)
    const markers = teethOf(units)
    const arch = archesOf(markers) ?? 'Both Arches'
    subTypeData.caseType2 = record('subTypeData.caseType2', arch, `tooth elements on the ${arch.toLowerCase()} (UNN)`, CONFIDENCE.MEDIUM)
    subTypeData.teeth = record('subTypeData.teeth', markers.length ? markers : fullArch(arch),
      markers.length ? 'ToothNumber of each denture element (UNN)' : `full ${arch.toLowerCase()}`, CONFIDENCE.MEDIUM)
  } else {
    // 3D Model
    const dieTeeth = scanSettings?.dieTeeth ?? []
    subTypeData.caseType1 = record('subTypeData.caseType1', 'Full Arch Model',
      'Model Builder job with no arch-shape marker in the file — defaulted; pick Quad/Contact/Horse Shoe/Implant Model by eye', CONFIDENCE.MANUAL)
    const solid = scanSettings?.closedBottom === true
    subTypeData.caseType2 = record('subTypeData.caseType2', solid ? 'Solid' : 'Hollow',
      scanSettings?.closedBottom == null
        ? 'SID_UserInputData.CloseBottomHole not found — defaulted to Hollow'
        : `SID_UserInputData.CloseBottomHole = ${scanSettings.closedBottom}`,
      scanSettings?.closedBottom == null ? CONFIDENCE.MANUAL : CONFIDENCE.MEDIUM)
    subTypeData.articulator = record('subTypeData.articulator',
      scanSettings?.articulatorUsed ? 'Yes' : 'No',
      scanSettings?.articulatorUsed == null
        ? 'SID_UserInputData.IsArticulatorHolderUsed not found — defaulted to No'
        : `SID_UserInputData.IsArticulatorHolderUsed = ${scanSettings.articulatorUsed}`,
      scanSettings?.articulatorUsed == null ? CONFIDENCE.MANUAL : CONFIDENCE.HIGH)
    subTypeData.drainHoles = record('subTypeData.drainHoles', 'No',
      'printing option, not present anywhere in the scan export — defaulted', CONFIDENCE.MANUAL)
    subTypeData.die = record('subTypeData.die', dieTeeth.length ? 'Yes' : 'No',
      dieTeeth.length ? `SID_UserInputData "MainStepDie" steps for tooth ${dieTeeth.join(', ')}` : 'no die scan steps in SID_UserInputData',
      scanSettings ? CONFIDENCE.HIGH : CONFIDENCE.MANUAL)
    subTypeData.teeth = record('subTypeData.teeth',
      dieTeeth.length ? dieTeeth : teethOf(units),
      dieTeeth.length ? 'die teeth from SID_UserInputData (UNN)' : 'tooth elements on the order (UNN)',
      dieTeeth.length ? CONFIDENCE.HIGH : CONFIDENCE.LOW)
  }

  /* ---------------- fields shared by every category ---------------- */

  // `ModelDesignModule` says the scan carries Model Builder data, NOT that the
  // client wants a printed model — nearly every scanner export sets it. Checked
  // against production: all 33 JDE Crown (17929) cases whose XML sets
  // `mdmModelBuilder` were entered as `modelRequired: "no"`, and the table as a
  // whole runs 172 "no" to 71 "yes". So this is a commercial choice we default
  // to "no" and flag, not something the file tells us.
  const hasModelData = Boolean(order.modelDesignModule && order.modelDesignModule !== 'mdmNone')
  subTypeData.modelRequired = record('subTypeData.modelRequired', options.modelRequired ?? 'no',
    options.modelRequired
      ? 'supplied via --model-required'
      : `a client choice, not in the scan file — defaulted to "no"${hasModelData ? ` (the scan does carry ${order.modelDesignModule} data, which is not the same thing)` : ''}`,
    options.modelRequired ? CONFIDENCE.HIGH : CONFIDENCE.MANUAL)

  subTypeData.toothSystem = record('subTypeData.toothSystem', 'USA',
    'ToothNumber in the 3Shape order XML is Universal Numbering (verified against Anatomy elements/UNN*.dcm)', CONFIDENCE.HIGH)

  subTypeData.notes = record('subTypeData.notes', buildNotes(parsed, options),
    'Order.OrderComments plus a scan-file summary', CONFIDENCE.HIGH)

  const casePayload = {
    // Must be filled in by the caller — the scan file identifies the lab only
    // by 3Shape's own customer strings, not by an IconicConnect client UUID.
    clientId: options.clientId ?? null,
    // Not represented anywhere in a scan export.
    serviceType: options.serviceType ?? 'design_only',
    category,
    subTypeData,
    caseNumber: CATEGORY_PREFIXES[category],
    // The API takes the uploaded-file records; upload the source .zip via the
    // normal chunked upload and splice the results in here.
    uploadedFile: null,
    uploadedFiles: [],
    preferredTeethLibrary: options.preferredTeethLibrary ?? 'default',
    teethLibraryFileUrl: null,
    teethLibraryFileName: null,
  }

  record('clientId', casePayload.clientId,
    `not in the scan file — resolve from Customer "${order.customer}" / ManufName "${order.manufacturer}" / ClientID "${order.scannerClientId}"`,
    casePayload.clientId ? CONFIDENCE.HIGH : CONFIDENCE.MANUAL)
  record('serviceType', casePayload.serviceType,
    'commercial choice, not in the scan file — defaulted to design_only', options.serviceType ? CONFIDENCE.HIGH : CONFIDENCE.MANUAL)
  record('category', category, categorySource({ has, order, modelElements }), CONFIDENCE.HIGH)

  return {
    casePayload,
    provenance,
    needsReview: Object.entries(provenance)
      .filter(([, p]) => p.confidence === CONFIDENCE.MANUAL || p.confidence === CONFIDENCE.LOW)
      .map(([field, p]) => ({ field, value: p.value, why: p.source, confidence: p.confidence })),
    unmapped: buildUnmapped(parsed, options),
    reviewNotes: notes,
  }
}

/* ------------------------------------------------------------------ */

function pickCategory({ has, order, units, modelElements, scanSettings }) {
  if (has('abutment')) return 'Implants'
  if (has('denture')) return 'Dentures'
  if (has('splint') || modelElements.some((m) => m.type === 'meSplint')) return 'Appliances'
  if (order.designModule === 'SplintStudio' || order.designModule === 'ApplianceDesigner') return 'Appliances'
  if (order.designModule === 'DentureDesigner' || order.designModule === 'RemovableDesigner') return 'Dentures'
  if (has('veneer') || has('waxup')) return 'Cosmetics'
  if (has('crown') || has('pontic') || has('coping') || has('inlay') || has('onlay') || has('cutback') || has('screwRetained')) {
    return 'Crown & Bridge'
  }
  // Nothing restorative left — a pure model job.
  return '3D Model'
}

function categorySource({ has, order, modelElements }) {
  if (has('abutment')) return 'teAbutment tooth element(s) present'
  if (has('splint') || modelElements.some((m) => m.type === 'meSplint')) return 'teSplint / meSplint element'
  if (has('denture')) return 'denture tooth element(s)'
  return `tooth element classes + DesignModuleID "${order.designModule}"`
}

function matchAppliance(text) {
  const table = [
    [/night\s*guard|nightguard|bruxi/i, 'Night Guards'],
    [/sport\s*guard|athletic/i, 'Sport Guards'],
    [/mouth\s*guard|mouthguard/i, 'Mouth Guards'],
    [/\bnti\b/i, 'NTI'],
  ]
  for (const [re, value] of table) {
    if (re.test(text)) return { value, source: `matched /${re.source}/ in the order indication text`, confidence: 'medium' }
  }
  return {
    value: 'Night Guards',
    source: '3Shape reports the element only as a generic "Splint" — defaulted to the most common appliance',
    confidence: 'manual',
  }
}

function matchDenture(text, units) {
  const table = [
    [/reference/i, 'Reference Denture'],
    [/copy/i, 'Copy Denture'],
    [/immediate/i, 'Immediate Denture'],
    [/partial|rpd|framework/i, 'Partial Denture'],
    [/full|complete/i, 'Full Denture'],
  ]
  for (const [re, value] of table) {
    if (re.test(text)) return { value, source: `matched /${re.source}/ in the order indication text`, confidence: 'medium' }
  }
  const partial = units.length > 0 && units.length < 14
  return {
    value: partial ? 'Partial Denture' : 'Full Denture',
    source: `${units.length} denture element(s) — inferred, confirm with the lab`,
    confidence: 'manual',
  }
}

function buildNotes(parsed, options) {
  const { order, units, scans, connectorGroups } = parsed
  const lines = []
  if (order.comments.trim()) {
    lines.push('--- Lab instructions (3Shape OrderComments) ---', order.comments.trim(), '')
  } else {
    // The written brief often reaches the lab outside the scan export entirely:
    // CAB-0271 had no OrderComments, yet its case notes carried the real
    // instruction ("design ... FCZ crowns") that decided the case type.
    lines.push('--- No lab instructions in the scan file — check for a separate brief ---', '')
  }
  lines.push('--- Imported from 3Shape scan file ---')
  lines.push(`Source order: ${order.orderId ?? 'n/a'}${order.clientOrderNo ? ` (client ref ${order.clientOrderNo})` : ''}`)
  // Patient names are deliberately not stored on cases (migration
  // 0005_remove_patient_name_from_cases.sql), so keep them out unless asked.
  if (options.includePatientName && order.patientName) lines.push(`Patient: ${order.patientName}`)
  lines.push(`Indication: ${order.itemsSummary || units.map((u) => u.indication).join(', ')}`)
  const units_ = units.filter((u) => u.unn)
  if (units_.length) {
    lines.push(`Units: ${units_.map((u) => `${u.indication} — UNN ${u.unn} (FDI ${u.fdi})`).join('; ')}`)
  }
  if (connectorGroups.length) lines.push(`Connected spans (UNN): ${connectorGroups.map((g) => g.join('-')).join(', ')}`)
  const materials = [...new Set(units.map((u) => u.material).filter(Boolean))]
  if (materials.length) lines.push(`Material: ${materials.join(' | ')}`)
  if (order.shade) lines.push(`Shade: ${order.shade}`)
  if (order.designModuleLabel) lines.push(`Design module: ${order.designModuleLabel}`)
  if (scans.length) lines.push(`Scans: ${scans.map((s) => s.label).join(', ')}`)
  if (order.scanDate) lines.push(`Scanned: ${order.scanDate}`)
  return lines.join('\n')
}

/** Everything the scan file carries that the case form has nowhere to put. */
function buildUnmapped(parsed, options) {
  const { order, units } = parsed
  const out = {
    sourceOrderId: order.orderId,
    numericOrderId: order.numericOrderId,
    scannerClientId: order.scannerClientId,
    customer: order.customer,
    manufacturer: order.manufacturer,
    operator: order.operator,
    priority: order.priority,
    scanSource: order.scanSource,
    scanModule: order.scanModule,
    createdFromApp: order.createdFromApp,
    requestedDeliveryDate: order.deliveryDate,
    scanDate: order.scanDate,
    materials: [...new Set(units.map((u) => u.material).filter(Boolean))],
    shade: order.shade,
    implantKits: [...new Set(units.map((u) => u.implantKit).filter(Boolean))],
    cadFiles: [...new Set(units.map((u) => u.cadFile).filter(Boolean))],
    validation: [...new Set(units.map((u) => u.validation).filter(Boolean))],
  }
  if (options.includePatientName) out.patientName = order.patientName
  return out
}
