import { describe, it, expect } from 'vitest'
import { classifyDownload, fileFingerprint, signatureOf } from '../fingerprint'

const r2 = (key: string, path = 'scan/a.stl') => ({ path, source: { kind: 'r2' as const, key } })

describe('fileFingerprint', () => {
  it('is stable for identical input', () => {
    expect(fileFingerprint({ ...r2('Lab/a.stl'), version: 'etag1' })).toBe(fileFingerprint({ ...r2('Lab/a.stl'), version: 'etag1' }))
  })
  it('changes when a same-named file is re-uploaded (new ETag), is path- and key-sensitive', () => {
    const base = fileFingerprint({ ...r2('Lab/a.stl'), version: 'etag1' })
    expect(fileFingerprint({ ...r2('Lab/a.stl'), version: 'etag2' })).not.toBe(base)
    expect(fileFingerprint({ ...r2('Lab/b.stl'), version: 'etag1' })).not.toBe(base)
    expect(fileFingerprint({ ...r2('Lab/a.stl', 'preview/a.stl'), version: 'etag1' })).not.toBe(base)
  })
})

describe('signatureOf', () => {
  it('ignores order', () => {
    expect(signatureOf(['b', 'a'])).toBe(signatureOf(['a', 'b']))
    expect(signatureOf(['a'])).not.toBe(signatureOf(['a', 'b']))
  })
})

describe('classifyDownload', () => {
  it('never when there is no completed download', () => {
    expect(classifyDownload(['a'], null)).toBe('never')
    expect(classifyDownload(['a'], undefined)).toBe('never')
  })
  it('downloaded when nothing new', () => {
    expect(classifyDownload(['a', 'b'], ['a', 'b'])).toBe('downloaded')
  })
  it('updated when a file is new or replaced', () => {
    expect(classifyDownload(['a', 'c'], ['a', 'b'])).toBe('updated')
    expect(classifyDownload(['a', 'b', 'p1'], ['a', 'b'])).toBe('updated')
  })
  it('a shrinking set (e.g. retention-deleted file) is not an update', () => {
    expect(classifyDownload(['a'], ['a', 'b'])).toBe('downloaded')
  })
})
