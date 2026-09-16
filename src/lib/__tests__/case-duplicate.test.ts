import { describe, expect, it } from 'vitest'
import {
  normalizeCaseFileName,
  resolveDuplicates,
  type ActiveCaseKey,
  type SoftEntry,
} from '../case-duplicate'

const active = (entries: Record<string, ActiveCaseKey[]>) =>
  new Map(Object.entries(entries))

describe('normalizeCaseFileName', () => {
  it('strips path + extension, lowercases, trims', () => {
    expect(normalizeCaseFileName('Cases/A/2238152.zip')).toBe('2238152')
    expect(normalizeCaseFileName('  Mervin_Heth.XML ')).toBe('mervin_heth')
    expect(normalizeCaseFileName('no-ext')).toBe('no-ext')
  })
})

describe('resolveDuplicates', () => {
  const soft = (over: Partial<SoftEntry> & { index: number }): SoftEntry => ({
    fileName: 'case.zip',
    teeth: [12, 13, 14],
    ...over,
  })

  it('skips an entry that matches an active case by name + tooth overlap', () => {
    const r = resolveDuplicates(
      [soft({ index: 2, fileName: '2238152.zip', teeth: [4, 5] })],
      active({ '2238152': [{ caseNumber: 'CAI-0007', teeth: new Set([5, 6]) }] }),
    )
    expect([...r.skipIndices]).toEqual([2])
    expect(r.skipped).toEqual([
      { fileName: '2238152.zip', teeth: [4, 5], existingCaseNumber: 'CAI-0007' },
    ])
  })

  it('keeps an entry when the name matches but no tooth overlaps', () => {
    const r = resolveDuplicates(
      [soft({ index: 0, fileName: '2238152.zip', teeth: [10, 11] })],
      active({ '2238152': [{ caseNumber: 'CAI-0007', teeth: new Set([5, 6]) }] }),
    )
    expect(r.skipIndices.size).toBe(0)
    expect(r.skipped).toEqual([])
  })

  it('keeps an entry when teeth overlap but the name differs', () => {
    const r = resolveDuplicates(
      [soft({ index: 0, fileName: 'different.zip', teeth: [5] })],
      active({ '2238152': [{ caseNumber: 'CAI-0007', teeth: new Set([5, 6]) }] }),
    )
    expect(r.skipIndices.size).toBe(0)
  })

  it('an active case with no teeth never suppresses anything', () => {
    const r = resolveDuplicates(
      [soft({ index: 0, fileName: 'x.zip', teeth: [5] })],
      active({ x: [{ caseNumber: 'CAB-1', teeth: new Set() }] }),
    )
    expect(r.skipIndices.size).toBe(0)
  })

  it('dedupes within the same request — second matching entry is dropped', () => {
    const r = resolveDuplicates(
      [
        soft({ index: 0, fileName: 'dup.zip', teeth: [12, 13] }),
        soft({ index: 1, fileName: 'dup.zip', teeth: [13, 14] }), // overlaps #0 on 13
        soft({ index: 2, fileName: 'dup.zip', teeth: [20, 21] }), // same name, no overlap → kept
      ],
      active({}),
    )
    expect([...r.skipIndices]).toEqual([1])
    expect(r.skipped[0]).toMatchObject({ fileName: 'dup.zip', existingCaseNumber: null })
  })

  it('normalises names (path/extension/case) on both sides before comparing', () => {
    const r = resolveDuplicates(
      [soft({ index: 0, fileName: 'folder/2238152.ZIP', teeth: [5] })],
      active({ '2238152': [{ caseNumber: 'CAI-0007', teeth: new Set([5]) }] }),
    )
    expect([...r.skipIndices]).toEqual([0])
  })

  it('no soft entries → empty result', () => {
    const r = resolveDuplicates([], active({}))
    expect(r.skipIndices.size).toBe(0)
    expect(r.skipped).toEqual([])
  })
})
