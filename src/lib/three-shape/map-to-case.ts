/**
 * Normalised 3Shape order -> IconicConnect case-form draft.
 *
 * Ported from `scripts/case-xml-extract/lib/map-to-case.mjs`, retargeted at the
 * canonical `CASE_HIERARCHY` (via `taxonomy.ts`) and the `DataQualityWarning`
 * model instead of the toolkit's free-text `needsReview` bag.
 *
 * Decisions folded in (xml-work-plan.md §20):
 *  - Q4: one order per zip — handled upstream in `package.ts`, not here.
 *  - Q5 (updated by case-modification-plan.md §1): `modelRequired` is left
 *    unset (never defaulted) + flagged — the lab must actively confirm
 *    Yes/No on the review screen before submitting.
 *  - Q6: Dentures — `caseType1` left BLANK + `DENTURE_TYPE_UNKNOWN`; arch derived.
 *  - `clientId` / `serviceType` are NOT emitted (session / carousel own them).
 */
import { archesOf, fullArch, type ParsedOrder, type ParsedUnit, type ScanSettings } from './dental-order'
import type { DataQualityWarning } from './model'
import { normalizeAppCategory, resolveOption } from './taxonomy'

export interface MappedDraft {
  /** Canonical app category, or `null` → the carousel forces a manual pick. */
  category: string | null
  /** Pre-normalisation category the classifier chose. */
  scriptCategory: string
  subTypeData: {
    caseType?: string
    caseType1?: string
    caseType2?: string
    occlusion?: string
    arch?: string
    die?: string
    articulator?: string
    drainHoles?: string
    teeth: number[]
    crownBridgeTeeth?: number[]
    toothSystem: 'USA'
    modelRequired?: 'yes' | 'no' | null
    notes: string
  }
  warnings: DataQualityWarning[]
}

export interface MapOptions {
  /** Fallback when the file gives us nothing — never inferred from a scan. */
  modelRequired?: 'yes' | 'no'
  includePatientName?: boolean
}

/** Abutment material keywords that mean a milled *custom* abutment. */
const METAL_ABUTMENT = /titan|\bti\b|\btan\b|cocr|co-cr|chrom|pre[-_ ]?milled|preface|\bau\b|gold/i
/** …versus a ceramic suprastructure bonded onto a prefabricated Ti base. */
const CERAMIC_ABUTMENT = /zirk|zirc|ceram|emax|e\.max|lithium|pmma|wax|peek|hybrid/i

export function mapOrderToDraft(
  parsed: ParsedOrder,
  scanSettings: ScanSettings | null = null,
  options: MapOptions = {},
): MappedDraft {
  const { order, units, connectorGroups } = parsed
  const warnings: DataQualityWarning[] = []

  const groups = new Set(units.map((u) => u.group))
  const has = (g: string) => groups.has(g)
  const unitsIn = (...g: string[]) => units.filter((u) => g.includes(u.group))
  const teethOf = (list: ParsedUnit[]) =>
    [...new Set(list.map((u) => u.unn).filter((n): n is number => Boolean(n)))].sort((a, b) => a - b)
  const indicationText = [order.itemsSummary, ...units.map((u) => u.indication)].join(' | ')
  const spanning = connectorGroups.some((g) => g.length > 1)

  const scriptCategory = pickCategory({ has, order, parsed })
  const category = normalizeAppCategory(scriptCategory)

  const subTypeData: MappedDraft['subTypeData'] = { teeth: [], toothSystem: 'USA', notes: '' }

  /** Set a select field to the canonical option, or flag it unmapped. */
  const setOption = (
    field: 'caseType' | 'caseType1' | 'caseType2' | 'occlusion' | 'arch' | 'die' | 'articulator' | 'drainHoles',
    candidate: string | null,
    why: string,
  ) => {
    if (candidate == null || !category) return
    const resolved = resolveOption(category, field, candidate)
    if (resolved) {
      subTypeData[field] = resolved
    } else {
      warnings.push({
        code: 'SUBTYPE_UNMAPPED',
        message: `${field} value "${candidate}" (${why}) has no matching option under ${category} — left blank for the client to pick.`,
        field,
      })
    }
  }

  /* ---------------- category-specific ---------------- */

  if (scriptCategory === 'Implants') {
    const abutments = unitsIn('abutment')
    const supra = unitsIn('crown', 'pontic', 'coping', 'screwRetained')
    const kitMaterial = abutments.map((a) => `${a.material ?? ''} ${a.implantKit ?? ''}`).join(' ')

    let subType: string
    if (METAL_ABUTMENT.test(kitMaterial) && !CERAMIC_ABUTMENT.test(kitMaterial)) {
      subType = 'Custom'
    } else if (CERAMIC_ABUTMENT.test(kitMaterial)) {
      subType = 'Ti-Base'
    } else {
      subType = 'Custom'
      warnings.push({
        code: 'CATEGORY_AMBIGUOUS',
        message: `Abutment material inconclusive ("${abutments[0]?.material ?? 'unknown'}") — defaulted implant sub-type to Custom. "Robotic" is never inferable from a scan.`,
        field: 'caseType1',
      })
    }
    setOption('caseType1', subType, 'abutment material')

    let attached = 'None'
    if (supra.length) attached = spanning || has('pontic') ? 'Bridge' : 'Crown'
    setOption('caseType2', attached, 'crown/pontic elements on the implant')

    subTypeData.teeth = teethOf(abutments)
    if (attached !== 'None') subTypeData.crownBridgeTeeth = teethOf(supra)
  } else if (scriptCategory === 'Crown & Bridge') {
    let caseType: string
    if (has('screwRetained') || (/screw[\s_-]?(access|retain)/i.test(order.comments) && has('abutment'))) {
      caseType = 'Screw Retained'
    } else if (has('inlay')) caseType = 'In-Lay'
    else if (has('onlay')) caseType = 'On-Lay'
    else if (has('cutback') || unitsIn('coping').some((u) => u.anatomical)) {
      caseType = 'Cutback'
      warnings.push({
        code: 'CATEGORY_AMBIGUOUS',
        message:
          'Anatomical coping element — that is 3Shape CAD set-up wording; the lab may have ordered Coping or a full-contour Crown. Verify.',
        field: 'caseType',
      })
    } else if (has('coping')) caseType = 'Coping'
    else if (spanning || has('pontic') || /bridge/i.test(indicationText)) caseType = 'Bridge'
    else caseType = 'Crown'
    setOption('caseType', caseType, 'tooth element classes / connector links')
    subTypeData.teeth = teethOf(units)
  } else if (scriptCategory === 'Cosmetics') {
    setOption('caseType', has('veneer') ? 'Veneers' : 'Digital Wax Up', 'veneer / wax-up element')
    subTypeData.teeth = teethOf(units)
  } else if (scriptCategory === 'Appliances') {
    const appliance = matchAppliance(indicationText)
    if (appliance) setOption('caseType1', appliance, 'order indication text')
    else
      warnings.push({
        code: 'SUBTYPE_UNMAPPED',
        message:
          '3Shape reports the element only as a generic "Splint" — pick the appliance type.',
        field: 'caseType1',
      })

    warnings.push({
      code: 'SUBTYPE_UNMAPPED',
      message: 'Occlusion (Even / Custom) is not recorded in a scan file — pick it.',
      field: 'occlusion',
    })

    const markers = teethOf(units)
    const arch = archesOf(markers) ?? 'Both Arches'
    setOption('arch', arch, `splint placeholder tooth ${markers.join(', ')}`)
    warnings.push({
      code: 'ARCH_INFERRED',
      message: `Arch derived from the splint placeholder tooth ${markers.join(', ') || '(none)'}.`,
      field: 'arch',
    })
    subTypeData.teeth = fullArch(arch)
  } else if (scriptCategory === 'Dentures') {
    // Q6: denture type is not in the file — leave caseType1 blank, flag it.
    warnings.push({
      code: 'DENTURE_TYPE_UNKNOWN',
      message:
        'Full / Partial / Immediate / Copy / Reference is not recorded in the scan — pick the denture type.',
      field: 'caseType1',
    })
    const markers = teethOf(units)
    const arch = archesOf(markers) ?? 'Both Arches'
    setOption('caseType2', arch, 'arches of the denture tooth elements')
    warnings.push({
      code: 'ARCH_INFERRED',
      message: `Arch derived from the denture tooth elements (${arch}).`,
      field: 'caseType2',
    })
    subTypeData.teeth = markers.length ? markers : fullArch(arch)
  } else {
    // 3D Model
    const dieTeeth = scanSettings?.dieTeeth ?? []
    setOption('caseType1', 'Full Arch Model', 'no arch-shape marker in the file — defaulted')
    warnings.push({
      code: 'CATEGORY_AMBIGUOUS',
      message: 'Model shape (Full Arch / Quad / Contact / Horse Shoe / Implant Model) is a visual call — confirm.',
      field: 'caseType1',
    })

    if (scanSettings?.closedBottom != null) {
      setOption('caseType2', scanSettings.closedBottom ? 'Solid' : 'Hollow', 'SID CloseBottomHole')
    } else {
      warnings.push({
        code: 'SUBTYPE_UNMAPPED',
        message: 'SID_UserInputData.CloseBottomHole not found — pick Hollow / Solid.',
        field: 'caseType2',
      })
    }

    setOption('articulator', scanSettings?.articulatorUsed ? 'Yes' : 'No', 'SID IsArticulatorHolderUsed')
    if (scanSettings?.articulatorUsed == null) {
      warnings.push({
        code: 'SUBTYPE_UNMAPPED',
        message: 'SID_UserInputData.IsArticulatorHolderUsed not found — defaulted Articulator to No.',
        field: 'articulator',
      })
    }

    setOption('drainHoles', 'No', 'printing option, not in the scan export — defaulted')
    warnings.push({
      code: 'SUBTYPE_UNMAPPED',
      message: 'Drain Holes is a printing option not present in a scan export — defaulted to No.',
      field: 'drainHoles',
    })

    setOption('die', dieTeeth.length ? 'Yes' : 'No', dieTeeth.length ? 'SID MainStepDie steps' : 'no die scan steps')
    subTypeData.teeth = dieTeeth.length ? dieTeeth : teethOf(units)
  }

  /* ---------------- shared ---------------- */

  if (category !== '3D Model') {
    // Unset, not defaulted (case-modification-plan.md §1) — the lab must
    // actively confirm Yes/No before the draft can be submitted; the
    // review carousel treats a blank modelRequired as "needs review".
    subTypeData.modelRequired = options.modelRequired ?? null
    if (!options.modelRequired) {
      warnings.push({
        code: 'MODEL_REQUIRED_DEFAULTED',
        message:
          'Whether the client wants a printed model is a commercial choice the scan file does not record — please confirm on the review screen.',
        field: 'modelRequired',
      })
    }
  }

  subTypeData.notes = buildNotes(parsed, options)

  return { category, scriptCategory, subTypeData, warnings }
}

/* ------------------------------------------------------------------ */

function pickCategory({
  has,
  order,
  parsed,
}: {
  has: (g: string) => boolean
  order: ParsedOrder['order']
  parsed: ParsedOrder
}): string {
  if (has('abutment')) return 'Implants'
  if (has('denture')) return 'Dentures'
  if (has('splint') || parsed.modelElements.some((m) => m.type === 'meSplint')) return 'Appliances'
  if (order.designModule === 'SplintStudio' || order.designModule === 'ApplianceDesigner') return 'Appliances'
  if (order.designModule === 'DentureDesigner' || order.designModule === 'RemovableDesigner') return 'Dentures'
  if (has('veneer') || has('waxup')) return 'Cosmetics'
  if (
    has('crown') ||
    has('pontic') ||
    has('coping') ||
    has('inlay') ||
    has('onlay') ||
    has('cutback') ||
    has('screwRetained')
  ) {
    return 'Crown & Bridge'
  }
  return '3D Model'
}

function matchAppliance(text: string): string | null {
  const table: Array<[RegExp, string]> = [
    [/night\s*guard|nightguard|bruxi/i, 'Night Guards'],
    [/sport\s*guard|athletic/i, 'Sport Guards'],
    [/mouth\s*guard|mouthguard/i, 'Mouth Guards'],
    [/\bnti\b/i, 'NTI'],
  ]
  for (const [re, value] of table) if (re.test(text)) return value
  return null
}

function buildNotes(parsed: ParsedOrder, options: MapOptions): string {
  const { order, units, scans, connectorGroups } = parsed
  const lines: string[] = []
  if (order.comments.trim()) {
    lines.push('--- Lab instructions (3Shape OrderComments) ---', order.comments.trim(), '')
  } else {
    lines.push('--- No lab instructions in the scan file — check for a separate brief ---', '')
  }
  lines.push('--- Imported from 3Shape scan file ---')
  lines.push(
    `Source order: ${order.orderId ?? 'n/a'}${order.clientOrderNo ? ` (client ref ${order.clientOrderNo})` : ''}`,
  )
  // Patient names are deliberately not stored on cases
  // (0005_remove_patient_name_from_cases.sql), so keep them out unless asked.
  if (options.includePatientName && order.patientName) lines.push(`Patient: ${order.patientName}`)
  lines.push(`Indication: ${order.itemsSummary || units.map((u) => u.indication).join(', ')}`)
  const numbered = units.filter((u) => u.unn)
  if (numbered.length) {
    lines.push(
      `Units: ${numbered.map((u) => `${u.indication} — UNN ${u.unn} (FDI ${u.fdi})`).join('; ')}`,
    )
  }
  if (connectorGroups.length) {
    lines.push(`Connected spans (UNN): ${connectorGroups.map((g) => g.join('-')).join(', ')}`)
  }
  const materials = [...new Set(units.map((u) => u.material).filter(Boolean))]
  if (materials.length) lines.push(`Material: ${materials.join(' | ')}`)
  if (order.shade) lines.push(`Shade: ${order.shade}`)
  if (order.designModuleLabel) lines.push(`Design module: ${order.designModuleLabel}`)
  if (scans.length) lines.push(`Scans: ${scans.map((s) => s.label).join(', ')}`)
  if (order.scanDate) lines.push(`Scanned: ${order.scanDate}`)
  return lines.join('\n')
}
