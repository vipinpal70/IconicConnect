/**
 * Bridge between the 3Shape extractor's vocabulary and the app's canonical
 * case taxonomy (`src/lib/case-hierarchy.ts`).
 *
 * The importer must emit the EXACT category key and option strings the case
 * form expects. Anything that doesn't resolve is left blank and flagged —
 * never coerced.
 *
 * Adapted for master2's (master's) taxonomy, which differs from the
 * xml-feature branch this was ported from: "Crown & Bridges"/"Denture"/
 * "Implant" (not "Crown & Bridge"/"Dentures"/"Implants"), no "3D Model"
 * category at all, and several option-string differences under Appliances
 * and Cosmetics (see master2-plan.md §3). A scriptCategory/option that has
 * no home under this taxonomy resolves to `null`/unmapped rather than being
 * forced — same fallback path xml-feature uses for anything it can't read.
 */
import { CASE_HIERARCHY } from '@/src/lib/case-hierarchy'

/** Canonical category keys, in form-display order. */
export const APP_CATEGORIES = Object.keys(CASE_HIERARCHY) as string[]

/**
 * 3Shape/toolkit category → canonical app category. The ported
 * `map-to-case` emits its own internal spellings (Crown & Bridge / Implants /
 * Dentures / …) — this maps those onto whatever this app's taxonomy actually
 * calls them. Deliberately has NO entry for "3D Model": a scan that would
 * have classified there has no category to land in on this branch, so it
 * falls through to the "last resort" lookup below, which also misses, and
 * `normalizeAppCategory` returns `null` — the review carousel already
 * handles a `null` category as "needs manual review" (see map-to-case.ts /
 * ThreeShapeImport.tsx), so this degrades safely rather than erroring.
 */
const THREESHAPE_CATEGORY_MAP: Record<string, string> = {
  'Crown & Bridge': 'Crown & Bridges',
  'Crown & Bridges': 'Crown & Bridges',
  Implants: 'Implant',
  Implant: 'Implant',
  Appliances: 'Appliances',
  Appliance: 'Appliances',
  Dentures: 'Denture',
  Denture: 'Denture',
  Cosmetics: 'Cosmetics',
  Cosmetic: 'Cosmetics',
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
 * `CASE_HIERARCHY` option strings. Keyed `"<category>::<field>"` using THIS
 * app's category names, lowercase candidate → canonical option.
 */
const OPTION_ALIASES: Record<string, Record<string, string>> = {
  'Cosmetics::caseType': {
    // Client page's actual option is the typo "Vineers", not "Veneers" —
    // every plausible spelling of the real word resolves to the typo so
    // submitted cases match what the manual form itself produces.
    veneers: 'Vineers',
    veneer: 'Vineers',
    vineers: 'Vineers',
    'digital waxup': 'Digital Wax Up',
    'wax up': 'Digital Wax Up',
    'wax-up': 'Digital Wax Up',
  },
  'Appliances::caseType1': {
    // map-to-case.ts's matchAppliance() always emits "Night Guards" /
    // "Sport Guards" / "Mouth Guards" / "NTI" — this app's actual options
    // are "Night Guards" / "Sports Guard" / "Mouth Guard" / "NTI" (note the
    // Sport(s)/Guard(s) pluralization swap on the middle two).
    'night guard': 'Night Guards',
    nightguard: 'Night Guards',
    'night guards': 'Night Guards',
    'sport guard': 'Sports Guard',
    'sports guard': 'Sports Guard',
    'sport guards': 'Sports Guard',
    'sports guards': 'Sports Guard',
    'spot guards': 'Sports Guard',
    'mouth guard': 'Mouth Guard',
    mouthguard: 'Mouth Guard',
    'mouth guards': 'Mouth Guard',
  },
  'Appliances::occlusion': {
    // map-to-case.ts never actually calls setOption('occlusion', ...) — it's
    // always left blank + flagged (the scan file doesn't record it) — kept
    // here only for safety/consistency, not currently exercised.
    'even occlusion': 'even occlusion',
    even: 'even occlusion',
    custom: 'custom',
  },
  // No 'Appliances::arch' alias for "Both Arches" — this app's Appliances
  // taxonomy has no such option (only Lower/Upper). A scan that infers
  // "Both Arches" here is intentionally left unmapped/blank; see
  // master2-plan.md §3.
  'Crown & Bridges::caseType': {
    inlay: 'In-Lay',
    'in lay': 'In-Lay',
    onlay: 'On-Lay',
    'on lay': 'On-Lay',
    'screw retained': 'Screw Retained',
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
