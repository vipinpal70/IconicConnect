import { describe, it, expect } from 'vitest'
import { sanitizeSegment, uniquePath, fileNameFromUrl } from '../names'

describe('bulk-download names', () => {
  it('sanitises traversal and reserved characters', () => {
    expect(sanitizeSegment('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(sanitizeSegment('a:b*c?.stl')).toBe('a_b_c_.stl')
    expect(sanitizeSegment('...')).toBe('file')
  })
  it('truncates long names keeping the extension', () => {
    const out = sanitizeSegment('x'.repeat(300) + '.stl')
    expect(out.length).toBe(150)
    expect(out.endsWith('.stl')).toBe(true)
  })
  it('de-duplicates case-insensitively', () => {
    const used = new Set<string>()
    expect(uniquePath('C1/a.stl', used)).toBe('C1/a.stl')
    expect(uniquePath('C1/A.stl', used)).toBe('C1/A (2).stl')
    expect(uniquePath('C1/a.stl', used)).toBe('C1/a (3).stl')
  })
  it('reads file name from proxy and plain URLs', () => {
    expect(fileNameFromUrl('/api/cases/files?labName=L&fileName=x%20y.stl')).toBe('x y.stl')
    expect(fileNameFromUrl('https://h/p/q/out.zip')).toBe('out.zip')
  })
})
