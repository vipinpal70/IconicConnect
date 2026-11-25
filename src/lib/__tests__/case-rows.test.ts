import { describe, expect, it } from 'vitest'
import { mergeCaseRows, type CaseRow } from '@/src/lib/live/case-rows'

const row = (id: string, day: number, status = 'in_progress'): CaseRow => ({ id, status, createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z` })
const opts = { priorityStatus: 'change_requested', filtered: false, hasMore: false }
const ids = (rows: CaseRow[]) => rows.map((r) => r.id).join('')
/** a is the newest */
const list = [row('a', 9), row('b', 8), row('c', 7)]
const all = ['a', 'b', 'c', 'n']

describe('mergeCaseRows', () => {
  it('changes a row in place and leaves the others alone', () => {
    const r = mergeCaseRows(list, ['b'], [row('b', 8, 'approved')], ['b'], opts)
    expect(ids(r.rows)).toBe('abc')
    expect(r.rows[1].status).toBe('approved')
    expect(r.rows[0]).toBe(list[0])
    expect(r).toMatchObject({ reload: false, updatesAvailable: false })
  })

  it('removes rows that were asked for and not returned', () => {
    const r = mergeCaseRows(list, ['b'], [], [], opts)
    expect(ids(r.rows)).toBe('ac')
    expect(r.reload).toBe(false)
  })

  it('adds a new case where it belongs', () => {
    expect(ids(mergeCaseRows(list, ['n'], [row('n', 10)], ['n'], opts).rows)).toBe('nabc')
    expect(ids(mergeCaseRows(list, ['n'], [row('n', 8, 'change_requested')], ['n'], opts).rows)).toBe('nabc')
    expect(ids(mergeCaseRows(list, ['n'], [row('n', 1)], ['n'], opts).rows)).toBe('abcn')
    expect(ids(mergeCaseRows([], ['n'], [row('n', 1)], ['n'], opts).rows)).toBe('n')
  })

  it('a row whose status becomes the priority one moves up, and back down when it no longer is', () => {
    const up = mergeCaseRows(list, ['c'], [row('c', 7, 'change_requested')], ['c'], opts)
    expect(ids(up.rows)).toBe('cab')
    expect(ids(mergeCaseRows(up.rows, ['c'], [row('c', 7)], ['c'], opts).rows)).toBe('abc')
  })

  it('a longer list: rows of later pages are not added at the end', () => {
    expect(ids(mergeCaseRows(list, ['n'], [row('n', 1)], ['n'], { ...opts, hasMore: true }).rows)).toBe('abc')
    expect(ids(mergeCaseRows(list, ['n'], [row('n', 10)], ['n'], { ...opts, hasMore: true }).rows)).toBe('nabc')
  })

  it('a longer list is reloaded when a row leaves the loaded part, or the next page would skip one', () => {
    const more = { ...opts, hasMore: true }
    expect(mergeCaseRows(list, ['b'], [], [], more).reload).toBe(true)
    const top = [row('p', 1, 'change_requested'), ...list]
    expect(mergeCaseRows(top, ['p'], [row('p', 1)], ['p'], more).reload).toBe(true)
    expect(mergeCaseRows(top, ['p'], [row('p', 1)], ['p'], opts).reload).toBe(false)
    expect(mergeCaseRows(list, ['c'], [row('c', 7, 'change_requested')], ['c'], more).reload).toBe(false)
    expect(mergeCaseRows(list, ['b'], [row('b', 8, 'approved')], ['b'], more).reload).toBe(false)
  })

  describe('with filters', () => {
    const filtered = { ...opts, filtered: true }
    it('nothing is added or reordered; a new match is announced', () => {
      const r = mergeCaseRows(list, all, [row('a', 9), row('b', 8), row('c', 7, 'change_requested'), row('n', 10)], all, filtered)
      expect(ids(r.rows)).toBe('abc')
      expect(r.rows[2].status).toBe('change_requested')
      expect(r).toMatchObject({ updatesAvailable: true, reload: false })
    })
    it('a new case that does not match is not announced', () => {
      expect(mergeCaseRows(list, ['n'], [row('n', 10)], [], filtered).updatesAvailable).toBe(false)
    })
    it('a row one may no longer see disappears', () => {
      expect(ids(mergeCaseRows(list, ['a'], [], [], filtered).rows)).toBe('bc')
    })
  })
})
