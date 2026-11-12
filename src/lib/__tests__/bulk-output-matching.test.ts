import { describe, expect, it } from 'vitest'
import {
  exactKey,
  looseKey,
  matchFile,
  matchFileToCase,
  needsNameOverride,
  type MatchableCase,
} from '@/src/lib/bulk-output-matching'

const kase = (id: string, scanFileNames: string[], caseNumber: string | null = null): MatchableCase => ({
  id,
  caseNumber,
  scanFileNames,
})

describe('name keys', () => {
  it('exactKey mirrors the single-upload rule', () => {
    expect(exactKey('Folder/Smith_J.ZIP')).toBe('smith_j')
    expect(exactKey('  Smith_J.stl ')).toBe('smith_j')
  })

  it('looseKey ignores separators, stacked extensions, copy markers and output suffixes', () => {
    const key = looseKey('Smith_J.zip')
    for (const variant of [
      'smith-j.stl',
      'Smith J (1).zip',
      'Smith_J_final.zip',
      'Smith_J - Copy.zip',
      'Copy of Smith_J.zip',
      'Smith_J.stl.zip',
      'Smith_J_design_v2.zip',
      'Smith_J (2)_final.zip',
    ]) {
      expect(looseKey(variant), variant).toBe(key)
    }
  })

  it('never strips a name down to nothing', () => {
    expect(looseKey('final.zip')).toBe('final')
    expect(looseKey('design.stl')).toBe('design')
  })
})

describe('matchFileToCase', () => {
  it('ranks exact over normalized over similar', () => {
    expect(matchFileToCase('Smith_J.zip', kase('a', ['Smith_J.zip']))?.tier).toBe('exact')
    expect(matchFileToCase('Smith_J_final.zip', kase('a', ['Smith_J.zip']))?.tier).toBe('normalized')
    expect(matchFileToCase('Smith_Jo.zip', kase('a', ['Smith_Jon_upper.zip']))).toBeNull()
    expect(matchFileToCase('Smith_Jhon.zip', kase('a', ['Smith_John.zip']))?.tier).toBe('similar')
  })

  it('checks every scan file, not just the first one', () => {
    expect(matchFileToCase('Lower.stl', kase('a', ['photo.jpg', 'Upper.stl', 'Lower.stl']))?.tier).toBe('exact')
  })

  it('matches on the case number only for long enough numbers', () => {
    expect(matchFileToCase('IC-20451.zip', kase('a', ['scan.zip'], 'IC-20451'))?.tier).toBe('case-number')
    expect(matchFileToCase('12.zip', kase('a', ['scan.zip'], '12'))).toBeNull()
  })
})

describe('matchFile', () => {
  const cases = [
    kase('c1', ['Smith_J.zip'], 'IC-1001'),
    kase('c2', ['scan.zip'], 'IC-1002'),
    kase('c3', ['scan.zip'], 'IC-1003'),
    kase('c4', ['Patel_Ravi.zip'], 'IC-1004'),
  ]

  it('auto-matches a single strong candidate', () => {
    expect(matchFile('smith j final.zip', cases)).toMatchObject({ status: 'matched', matchedCaseId: 'c1', tier: 'normalized' })
  })

  it('asks the user to choose when several cases share a name', () => {
    expect(matchFile('scan.zip', cases)).toMatchObject({ status: 'ambiguous', matchedCaseId: null, candidateIds: ['c2', 'c3'] })
  })

  it('only suggests similar names', () => {
    expect(matchFile('Patel_Ravii.zip', cases)).toMatchObject({ status: 'suggested', matchedCaseId: null, candidateIds: ['c4'] })
  })

  it('reports no match', () => {
    expect(matchFile('unrelated.zip', cases)).toMatchObject({ status: 'unmatched', candidateIds: [] })
  })

  it('requires an explicit override for anything weaker than an auto-match', () => {
    expect(needsNameOverride('Smith_J_final.zip', cases[0])).toBe(false)
    expect(needsNameOverride('Patel_Ravii.zip', cases[3])).toBe(true)
    expect(needsNameOverride('unrelated.zip', cases[0])).toBe(true)
  })
})
