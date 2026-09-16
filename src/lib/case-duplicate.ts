/**
 * Pure duplicate-resolution for the 3Shape import flow (xml-work-plan.md §9 / Q2).
 *
 * `POST /api/cases` does the DB reads; this decides, given those rows, which
 * `skipIfDuplicate` entries to drop. Kept side-effect-free so it can be tested
 * without a database.
 *
 * Rule: an entry is a duplicate of an ACTIVE case (or of an earlier kept entry
 * in the same request) when the zip basename matches AND their tooth sets
 * overlap. Overlap — not exact equality — is deliberate (a re-upload after a
 * small correction still shares most teeth); keep the operator here so it's a
 * one-line change to tighten.
 */

/** Strip any directory prefix, drop the extension, trim + lowercase. */
export function normalizeCaseFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase()
}

export interface ActiveCaseKey {
  caseNumber: string | null
  teeth: Set<number>
}

export interface SoftEntry {
  /** Index into the original `POST /api/cases` array. */
  index: number
  /** The entry's (first) uploaded file name — already a plain basename is fine. */
  fileName: string
  teeth: number[]
}

export interface SkippedEntry {
  fileName: string
  teeth: number[]
  existingCaseNumber: string | null
}

export interface DuplicateResolution {
  skipIndices: Set<number>
  skipped: SkippedEntry[]
}

const setsOverlap = (a: Set<number>, b: Set<number>): boolean =>
  b.size > 0 && [...a].some((t) => b.has(t))

/**
 * @param soft         the request's `skipIfDuplicate` entries, in array order
 * @param activeByName  normalized-zip-name → active cases sharing that name
 */
export function resolveDuplicates(
  soft: SoftEntry[],
  activeByName: Map<string, ActiveCaseKey[]>,
): DuplicateResolution {
  const skipIndices = new Set<number>()
  const skipped: SkippedEntry[] = []
  const keptInBatch: Array<{ key: string; teeth: Set<number> }> = []

  for (const entry of soft) {
    const key = normalizeCaseFileName(entry.fileName)
    const teeth = new Set(entry.teeth)

    const activeHit = (activeByName.get(key) ?? []).find((c) => setsOverlap(teeth, c.teeth))
    const batchHit = keptInBatch.find((k) => k.key === key && setsOverlap(teeth, k.teeth))

    if (activeHit || batchHit) {
      skipIndices.add(entry.index)
      skipped.push({
        fileName: entry.fileName,
        teeth: [...teeth],
        existingCaseNumber: activeHit?.caseNumber ?? null,
      })
    } else {
      keptInBatch.push({ key, teeth })
    }
  }

  return { skipIndices, skipped }
}
