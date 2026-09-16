/**
 * Bridge between the 3Shape extractor's vocabulary and the app's canonical
 * case taxonomy (`src/lib/case-hierarchy.ts`).
 *
 * The importer must emit the EXACT category key and option strings the case
 * form and the `service_catalog` check expect (xml-work-plan.md §7 /
 * case-architecture-plan.md §4). Anything that doesn't resolve is left blank
 * and flagged — never coerced.
 */
import { CASE_HIERARCHY } from '@/src/lib/case-hierarchy'

/** Canonical category keys, in form-display order. */
export const APP_CATEGORIES = Object.keys(CASE_HIERARCHY) as string[]

/**
 * 3Shape/toolkit category → canonical app category. The ported
 * `map-to-case` already emits the canonical spellings, so this is mostly an
 * identity guard; it also catches legacy toolkit output.
 */
const THREESHAPE_CATEGORY_MAP: Record<string, string> = {
  'Crown & Bridge': 'Crown & Bridge',
  'Crown & Bridges': 'Crown & Bridge',
  Implants: 'Implants',
  Implant: 'Implants',
  Appliances: 'Appliances',
  Appliance: 'Appliances',
  Dentures: 'Dentures',
  Denture: 'Dentures',
  Cosmetics: 'Cosmetics',
  Cosmetic: 'Cosmetics',
  '3D Model': '3D Model',
}

/** Returns the canonical category key, or `null` if it has no app home. */
export function normalizeAppCategory(scriptCategory: string | null | undefined): string | null {
  if (!scriptCategory) return null
  const mapped = THREESHAPE_CATEGORY_MAP[scriptCategory]
  if (mapped && CASE_HIERARCHY[mapped]) return mapped
  // last resort: exact match against a canonical key
  return CASE_HIERARCHY[scriptCategory] ? scriptCategory : null
}

/**
 * Known spelling drift between toolkit output / 3Shape text and the canonical
 * `CASE_HIERARCHY` option strings. Keyed `"<category>::<field>"`, lowercase
 * candidate → canonical option.
 */
const OPTION_ALIASES: Record<string, Record<string, string>> = {
  'Cosmetics::caseType': {
    vineers: 'Veneers',
    veneer: 'Veneers',
    'digital waxup': 'Digital Wax Up',
    'wax up': 'Digital Wax Up',
    'wax-up': 'Digital Wax Up',
  },
  'Appliances::caseType1': {
    'night guard': 'Night Guards',
    nightguard: 'Night Guards',
    'sport guard': 'Sport Guards',
    'sports guard': 'Sport Guards',
    'spot guards': 'Sport Guards',
    'mouth guard': 'Mouth Guards',
    mouthguard: 'Mouth Guards',
  },
  'Appliances::occlusion': {
    'even occlusion': 'Even Occlusion',
    even: 'Even Occlusion',
    custom: 'Custom',
  },
  'Crown & Bridge::caseType': {
    inlay: 'In-Lay',
    'in lay': 'In-Lay',
    onlay: 'On-Lay',
    'on lay': 'On-Lay',
    'screw retained': 'Screw Retained',
  },
  '3D Model::caseType2': {
    solid: 'Solid',
    hollow: 'Hollow',
  },
}

/**
 * Resolve a candidate value to the exact `CASE_HIERARCHY` option for
 * `(category, field)`. Tries: exact → case-insensitive → alias table.
 * Returns `null` when nothing matches (→ blank field + `SUBTYPE_UNMAPPED`).
 */
export function resolveOption(
  category: string,
  field: string,
  candidate: string | null | undefined,
): string | null {
  if (!candidate) return null
  const def = CASE_HIERARCHY[category]
  const options = def?.fields.find((f) => f.name === field)?.options
  if (!options) return null

  if (options.includes(candidate)) return candidate

  const lc = candidate.trim().toLowerCase()
  const ciHit = options.find((o) => o.toLowerCase() === lc)
  if (ciHit) return ciHit

  const alias = OPTION_ALIASES[`${category}::${field}`]?.[lc]
  if (alias && options.includes(alias)) return alias

  return null
}

/** The `subTypeData` field names a category renders (from `CASE_HIERARCHY`). */
export function fieldsFor(category: string): string[] {
  return CASE_HIERARCHY[category]?.fields.map((f) => f.name) ?? []
}
