import { describe, expect, it } from 'vitest'
import { normalizeAppCategory, resolveOption, fieldsFor } from '../taxonomy'

describe('normalizeAppCategory', () => {
  it('passes canonical keys through and maps legacy spellings', () => {
    expect(normalizeAppCategory('Crown & Bridge')).toBe('Crown & Bridges')
    expect(normalizeAppCategory('Implant')).toBe('Implant')
    expect(normalizeAppCategory('Implants')).toBe('Implant')
    expect(normalizeAppCategory('Dentures')).toBe('Denture')
    // No "3D Model" category on this branch — a scan that would have
    // classified there has no app home and resolves to null.
    expect(normalizeAppCategory('3D Model')).toBeNull()
  })
  it('returns null for anything with no app home', () => {
    expect(normalizeAppCategory('Splint Studio')).toBeNull()
    expect(normalizeAppCategory(null)).toBeNull()
  })
})

describe('resolveOption', () => {
  it('exact match wins', () => {
    expect(resolveOption('Crown & Bridges', 'caseType', 'Bridge')).toBe('Bridge')
  })
  it('case-insensitive and alias fallbacks', () => {
    // Client page's actual option is the typo "Vineers", not "Veneers".
    expect(resolveOption('Cosmetics', 'caseType', 'vineers')).toBe('Vineers')
    expect(resolveOption('Cosmetics', 'caseType', 'Veneers')).toBe('Vineers')
    // map-to-case.ts emits "Sport Guards"; this app's option is "Sports Guard".
    expect(resolveOption('Appliances', 'caseType1', 'Sport Guards')).toBe('Sports Guard')
    expect(resolveOption('Appliances', 'occlusion', 'even occlusion')).toBe('even occlusion')
    expect(resolveOption('Crown & Bridges', 'caseType', 'inlay')).toBe('In-Lay')
  })
  it('leaves "Both Arches" unmapped under Appliances — no such option here', () => {
    expect(resolveOption('Appliances', 'arch', 'Both Arches')).toBeNull()
  })
  it('returns null when nothing matches', () => {
    expect(resolveOption('Crown & Bridges', 'caseType', 'Frobnicate')).toBeNull()
    expect(resolveOption('Crown & Bridges', 'caseType', null)).toBeNull()
  })
})

describe('fieldsFor', () => {
  it('lists a category’s subTypeData field names', () => {
    expect(fieldsFor('Implant')).toEqual(['caseType1', 'caseType2'])
    expect(fieldsFor('Denture')).toEqual(['caseType1', 'caseType2'])
    expect(fieldsFor('nope')).toEqual([])
  })
})
