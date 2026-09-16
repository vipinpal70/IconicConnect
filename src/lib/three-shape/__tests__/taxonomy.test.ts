import { describe, expect, it } from 'vitest'
import { normalizeAppCategory, resolveOption, fieldsFor } from '../taxonomy'

describe('normalizeAppCategory', () => {
  it('passes canonical keys through and maps legacy spellings', () => {
    expect(normalizeAppCategory('Crown & Bridge')).toBe('Crown & Bridge')
    expect(normalizeAppCategory('Implant')).toBe('Implants')
    expect(normalizeAppCategory('Denture')).toBe('Dentures')
    expect(normalizeAppCategory('3D Model')).toBe('3D Model')
  })
  it('returns null for anything with no app home', () => {
    expect(normalizeAppCategory('Splint Studio')).toBeNull()
    expect(normalizeAppCategory(null)).toBeNull()
  })
})

describe('resolveOption', () => {
  it('exact match wins', () => {
    expect(resolveOption('Crown & Bridge', 'caseType', 'Bridge')).toBe('Bridge')
  })
  it('case-insensitive and alias fallbacks', () => {
    expect(resolveOption('Cosmetics', 'caseType', 'vineers')).toBe('Veneers')
    expect(resolveOption('Appliances', 'caseType1', 'Sports Guard')).toBe('Sport Guards')
    expect(resolveOption('Appliances', 'occlusion', 'even occlusion')).toBe('Even Occlusion')
    expect(resolveOption('Crown & Bridge', 'caseType', 'inlay')).toBe('In-Lay')
  })
  it('returns null when nothing matches', () => {
    expect(resolveOption('Crown & Bridge', 'caseType', 'Frobnicate')).toBeNull()
    expect(resolveOption('Crown & Bridge', 'caseType', null)).toBeNull()
  })
})

describe('fieldsFor', () => {
  it('lists a category’s subTypeData field names', () => {
    expect(fieldsFor('Implants')).toEqual(['caseType1', 'caseType2'])
    expect(fieldsFor('3D Model')).toContain('die')
    expect(fieldsFor('nope')).toEqual([])
  })
})
