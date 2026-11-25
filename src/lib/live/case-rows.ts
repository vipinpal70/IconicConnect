/** Putting freshly fetched rows into a loaded cases list. Pure, so the rules can be tested on their own. */

export interface CaseRow {
  id: string
  status: string
  createdAt?: string | Date | null
}

export interface MergeOptions {
  /** This status comes first in the list, as in GET /api/cases. */
  priorityStatus: string
  /** Filters are applied: rows change in place, but nothing is added or reordered under the user. */
  filtered: boolean
  /** There are rows beyond those loaded. */
  hasMore: boolean
}

export interface MergeResult<T> {
  rows: T[]
  /** A filtered list would show more cases after a refresh. */
  updatesAvailable: boolean
  /** Rows left the loaded part of a longer list: reload the loaded pages, or the next page would skip some. */
  reload: boolean
}

const time = (row: CaseRow) => (row.createdAt ? new Date(row.createdAt).getTime() : 0)

/**
 * `asked`: the ids requested. Those missing from `fresh` are gone, or no longer for this person to see.
 * `matching`: which of the fresh rows match the filters.
 */
export function mergeCaseRows<T extends CaseRow>(
  prev: T[],
  asked: string[],
  fresh: T[],
  matching: string[],
  { priorityStatus, filtered, hasMore }: MergeOptions,
): MergeResult<T> {
  const freshById = new Map(fresh.map((r) => [r.id, r]))
  const known = new Set(prev.map((r) => r.id))
  const askedIds = new Set(asked)
  const matches = new Set(matching)
  const kept = prev.filter((r) => !askedIds.has(r.id) || freshById.has(r.id))
  const rows = kept.map((r) => freshById.get(r.id) ?? r)
  const added = fresh.filter((r) => !known.has(r.id) && matches.has(r.id))
  if (filtered) return { rows, updatesAvailable: added.length > 0, reload: false }

  const rank = (r: T) => (r.status === priorityStatus ? 0 : 1)
  const order = (a: T, b: T) => rank(a) - rank(b) || time(b) - time(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  const demoted = kept.some((r, i) => rank(r) < rank(rows[i]))
  const promoted = kept.some((r, i) => rank(r) > rank(rows[i]))
  const reload = hasMore && (demoted || kept.length < prev.length)
  // With more pages to come, an added row that belongs after the last loaded one is on a later page
  const last = rows[rows.length - 1]
  const fits = hasMore && last ? added.filter((r) => order(r, last) < 0) : added
  const moved = demoted || promoted || fits.length > 0
  return { rows: moved ? [...rows, ...fits].sort(order) : rows, updatesAvailable: false, reload }
}
