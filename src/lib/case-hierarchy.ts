// Single source of truth for case category/sub-type options — shared by
// AddCaseDialog.tsx and client/(dashboard)/cases/page.tsx, which used to
// keep two independently-drifted copies of this list (see
// case-creation-service-enforcement-plan.md). Category and sub-category
// values here are the canonical strings and must match `service_catalog`
// (category, sub_category) exactly — they're used both to render the case
// form and, server-side, to check whether a client is allowed to submit a
// given service.

export interface CaseHierarchyField {
  name: string
  label: string
  type: string
  options: string[]
  optional?: boolean
}

export interface CaseHierarchyCategory {
  fields: CaseHierarchyField[]
}

const ARCH_OPTIONS = ['Upper', 'Lower', 'Both Arches'] as const

export const CASE_HIERARCHY: Record<string, CaseHierarchyCategory> = {
  'Crown & Bridge': {
    fields: [
      { name: 'caseType', label: 'Case Type', type: 'select', options: ['Crown', 'Bridge', 'Cutback', 'Coping', 'Screw Retained', 'In-Lay', 'On-Lay'] },
    ],
  },
  Dentures: {
    fields: [
      { name: 'caseType1', label: 'Case Type', type: 'select', options: ['Reference Denture', 'Copy Denture', 'Immediate Denture', 'Full Denture', 'Partial Denture'] },
      { name: 'caseType2', label: 'Arch', type: 'select', options: [...ARCH_OPTIONS] },
    ],
  },
  Cosmetics: {
    fields: [
      { name: 'caseType', label: 'Case Type', type: 'select', options: ['Digital Wax Up', 'Veneers', 'Snap on Smile'] },
    ],
  },
  Appliances: {
    fields: [
      { name: 'caseType1', label: 'Case Type', type: 'select', options: ['Night Guards', 'Sport Guards', 'Mouth Guards', 'NTI'] },
      { name: 'occlusion', label: 'Occlusion', type: 'select', options: ['Even Occlusion', 'Custom'] },
      { name: 'arch', label: 'Arch', type: 'select', options: [...ARCH_OPTIONS] },
    ],
  },
  Implants: {
    fields: [
      { name: 'caseType1', label: 'Sub Type', type: 'select', options: ['Robotic', 'Custom', 'Ti-Base'] },
      { name: 'caseType2', label: 'Crown & Bridge type', type: 'select', options: ['None', 'Crown', 'Bridge'], optional: true },
    ],
  },
  '3D Model': {
    fields: [
      { name: 'caseType1', label: 'Case Type', type: 'select', options: ['Full Arch Model', 'Quad Model', 'Contact Model', 'Horse Shoe Model', 'Implant Model'] },
      { name: 'caseType2', label: 'Model Type', type: 'select', options: ['Hollow', 'Solid'] },
      { name: 'die', label: 'Die', type: 'select', options: ['Yes', 'No'] },
      { name: 'articulator', label: 'Articulator', type: 'select', options: ['Yes', 'No'] },
      { name: 'drainHoles', label: 'Drain Holes', type: 'select', options: ['Yes', 'No'] },
    ],
  },
}

export interface ServiceSelection {
  category: string
  subCategory: string
}

/**
 * Which `service_catalog` (category, subCategory) rows a submitted case
 * touches. Most categories select exactly one; 3D Model's die/articulator/
 * drainHoles Yes/No flags and Implants' optional Crown & Bridge attachment
 * each add an extra row on top of the primary selection.
 */
export function getRequiredServiceSelections(
  category: string,
  subTypeData: Record<string, unknown> | null | undefined
): ServiceSelection[] {
  const data = subTypeData || {}
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  const selections: ServiceSelection[] = []

  switch (category) {
    case 'Crown & Bridge':
    case 'Cosmetics': {
      const caseType = str(data.caseType)
      if (caseType) selections.push({ category, subCategory: caseType })
      break
    }
    case 'Dentures':
    case 'Appliances': {
      const caseType1 = str(data.caseType1)
      if (caseType1) selections.push({ category, subCategory: caseType1 })
      break
    }
    case 'Implants': {
      const caseType1 = str(data.caseType1)
      if (caseType1) selections.push({ category, subCategory: caseType1 })
      const caseType2 = str(data.caseType2)
      if (caseType2 && caseType2 !== 'None') {
        selections.push({ category: 'Crown & Bridge', subCategory: caseType2 })
      }
      break
    }
    case '3D Model': {
      const caseType1 = str(data.caseType1)
      if (caseType1) selections.push({ category, subCategory: caseType1 })
      if (data.die === 'Yes') selections.push({ category, subCategory: 'Die' })
      if (data.articulator === 'Yes') selections.push({ category, subCategory: 'Articulator' })
      if (data.drainHoles === 'Yes') selections.push({ category, subCategory: 'Drain Holes' })
      break
    }
    default:
      break
  }

  return selections
}

export interface PricedRow {
  category: string
  subCategory: string
  isActive: boolean
  isEnabled: boolean
}

/** `${category}::${subCategory}` keys for every service enabled (system-active
 * AND client-enabled) for this client/flow — built once from a price-list
 * fetch, then cheap to query per rendered option. */
export function buildEnabledKeySet(rows: PricedRow[]): Set<string> {
  const set = new Set<string>()
  for (const row of rows) {
    if (row.isActive && row.isEnabled) set.add(`${row.category}::${row.subCategory}`)
  }
  return set
}

/**
 * Whether picking `option` for `fieldName` under `category` is allowed for
 * this client — mirrors getRequiredServiceSelections' compound-selection
 * rules (3D Model add-on flags, Implants' Crown & Bridge attachment) but
 * evaluated per-option so the UI can filter/grey out choices instead of
 * only rejecting after submit.
 */
export function isFieldOptionEnabled(
  category: string,
  fieldName: string,
  option: string,
  enabledKeys: Set<string>
): boolean {
  // Fields that are case metadata, not a priced service selector.
  if (fieldName === 'arch' || fieldName === 'occlusion') return true
  if (category === 'Dentures' && fieldName === 'caseType2') return true
  if (category === '3D Model' && fieldName === 'caseType2') return true

  if (category === '3D Model' && (fieldName === 'die' || fieldName === 'articulator' || fieldName === 'drainHoles')) {
    if (option === 'No') return true
    const subCategory = fieldName === 'die' ? 'Die' : fieldName === 'articulator' ? 'Articulator' : 'Drain Holes'
    return enabledKeys.has(`${category}::${subCategory}`)
  }

  if (category === 'Implants' && fieldName === 'caseType2') {
    if (option === 'None') return true
    return enabledKeys.has(`Crown & Bridge::${option}`)
  }

  // Primary service-selector fields (caseType / caseType1) map directly onto
  // this category's own catalog rows.
  return enabledKeys.has(`${category}::${option}`)
}

/** A category is offered at all only if at least one of its primary
 * (non-metadata) options is enabled for this client/flow. */
export function isCategoryAvailable(category: string, enabledKeys: Set<string>): boolean {
  const def = CASE_HIERARCHY[category]
  if (!def) return false
  const primaryField = def.fields.find((f) => f.name === 'caseType' || f.name === 'caseType1')
  if (!primaryField) return true
  return primaryField.options.some((opt) => isFieldOptionEnabled(category, primaryField.name, opt, enabledKeys))
}