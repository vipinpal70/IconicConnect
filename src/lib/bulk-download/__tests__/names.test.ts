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
    expect(fileNameFromUrl(
      '/api/cases/files?labName=L&fileName=case-outputs%2F3f2b8c1e-7a4d-4e0b-9c55-1d2e3f4a5b6c%2F0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d%2FSmith%20J.zip',
    )).toBe('Smith J.zip')
  })
})
