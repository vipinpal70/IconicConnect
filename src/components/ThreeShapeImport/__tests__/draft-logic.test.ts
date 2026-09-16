import { describe, expect, it } from 'vitest'
import {
  draftValid,
  fieldIsEmpty,
  highlightFields,
  isForced,
  openWarnings,
  type DraftLike,
} from '../draft-logic'
import type { DataQualityWarning } from '@/src/lib/three-shape/model'

const base = (over: Partial<DraftLike> = {}): DraftLike => ({
  ok: true,
  skip: false,
  category: 'Crown & Bridges',
  subTypeData: { teeth: [12, 13, 14], toothSystem: 'USA', notes: '', caseType: 'Bridge', modelRequired: 'no' },
  warnings: [],
  duplicateOf: null,
  ...over,
})

describe('draftValid', () => {
  it('a fully-filled Crown & Bridges draft is valid', () => {
    expect(draftValid(base())).toBe(true)
  })

  it('a skipped draft never blocks the batch, even if incomplete', () => {
    expect(draftValid(base({ skip: true, category: null, subTypeData: { teeth: [], toothSystem: 'USA', notes: '' } }))).toBe(true)
  })

  it('an unreadable (ok:false) draft that is NOT skipped is invalid', () => {
    expect(draftValid(base({ ok: false, skip: false }))).toBe(false)
  })

  it('requires a category', () => {
    expect(draftValid(base({ category: null }))).toBe(false)
  })

  it('every category sub-type field is optional — a blank caseType1 no longer blocks a Denture draft', () => {
    const d = base({
      category: 'Denture',
      subTypeData: { teeth: [7, 8], toothSystem: 'USA', notes: '', caseType2: 'Upper', modelRequired: 'no' },
    })
    expect(draftValid(d)).toBe(true) // caseType1 blank — still valid
  })

  it('requires teeth for every category (no 3D Model carve-out on this branch)', () => {
    expect(draftValid(base({ subTypeData: { teeth: [], toothSystem: 'USA', notes: '', caseType: 'Crown', modelRequired: 'no' } }))).toBe(false)
  })

  it('requires an explicit Model Required choice', () => {
    expect(draftValid(base({ subTypeData: { teeth: [12], toothSystem: 'USA', notes: '', caseType: 'Crown' } }))).toBe(false)
    expect(draftValid(base({ subTypeData: { teeth: [12], toothSystem: 'USA', notes: '', caseType: 'Crown', modelRequired: 'no' } }))).toBe(true)
  })

  it('Implant with a Crown/Bridge attachment no longer requires crownBridgeTeeth to submit', () => {
    const d = base({
      category: 'Implant',
      subTypeData: {
        teeth: [4], toothSystem: 'USA', notes: '', modelRequired: 'no',
        caseType1: 'Ti-Base', caseType2: 'Crown', crownBridgeTeeth: [],
      },
    })
    expect(draftValid(d)).toBe(true)
  })
})

describe('openWarnings / highlightFields', () => {
  const w = (code: string, field?: string): DataQualityWarning =>
    ({ code, message: `${code}`, field } as DataQualityWarning)

  it('field warnings clear once the field is filled; informational ones stay', () => {
    const d = base({
      subTypeData: { teeth: [12], toothSystem: 'USA', notes: '', modelRequired: 'no' },
      warnings: [w('SUBTYPE_UNMAPPED', 'caseType'), w('TOOTH_NUMBER_CONFLICT')],
    })
    expect(highlightFields(d)).toEqual(['caseType'])
    expect(openWarnings(d).map((x) => x.code)).toEqual(['SUBTYPE_UNMAPPED', 'TOOTH_NUMBER_CONFLICT'])

    d.subTypeData.caseType = 'Bridge'
    expect(highlightFields(d)).toEqual([])
    expect(openWarnings(d).map((x) => x.code)).toEqual(['TOOTH_NUMBER_CONFLICT'])
  })

  it('an empty teeth array counts as unfilled', () => {
    const d = base({
      subTypeData: { teeth: [], toothSystem: 'USA', notes: '' },
      warnings: [w('ARCH_INFERRED', 'teeth')],
    })
    expect(fieldIsEmpty(d.subTypeData, 'teeth')).toBe(true)
    expect(highlightFields(d)).toEqual(['teeth'])
  })
})

describe('isForced', () => {
  it('true only for a duplicate the user un-skipped', () => {
    expect(isForced(base({ duplicateOf: { caseId: 'x', caseNumber: 'CAB-1', status: 'in_progress' }, skip: false }))).toBe(true)
    expect(isForced(base({ duplicateOf: { caseId: 'x', caseNumber: 'CAB-1', status: 'in_progress' }, skip: true }))).toBe(false)
    expect(isForced(base({ duplicateOf: null, skip: false }))).toBe(false)
  })
})
