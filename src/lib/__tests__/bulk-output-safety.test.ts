import { describe, expect, it } from 'vitest'
import { bulkAttachDenialReason } from '@/src/lib/bulk-output-eligibility'
import { caseScopedStorageName, displayFileName, uploadStorageName } from '@/src/lib/case-file-keys'
import { isValidUploadFileName } from '@/src/lib/security/file-name'

const CASE_ID = '3f2b8c1e-7a4d-4e0b-9c55-1d2e3f4a5b6c'

describe('bulkAttachDenialReason', () => {
  const kase = { status: 'in_progress', designerId: 'd1', qcId: 'q1' }

  it('lets designers and QC attach only to their own in-progress cases', () => {
    expect(bulkAttachDenialReason({ id: 'd1', role: 'designer' }, kase)).toBeNull()
    expect(bulkAttachDenialReason({ id: 'q1', role: 'qc' }, kase)).toBeNull()
    expect(bulkAttachDenialReason({ id: 'd2', role: 'designer' }, kase)).toMatch(/assigned designer/)
    expect(bulkAttachDenialReason({ id: 'q2', role: 'qc' }, kase)).toMatch(/assigned QC/)
    // A designer who is the case's QC (or vice versa) doesn't get the other role's rights
    expect(bulkAttachDenialReason({ id: 'q1', role: 'designer' }, kase)).not.toBeNull()
  })

  it('lets admins attach to any in-progress case', () => {
    expect(bulkAttachDenialReason({ id: 'a', role: 'admin' }, kase)).toBeNull()
  })

  it('refuses cases that are no longer in progress, for everyone', () => {
    for (const role of ['admin', 'designer', 'qc']) {
      expect(bulkAttachDenialReason({ id: 'd1', role }, { ...kase, status: 'internal_qc', qcId: 'd1' })).toMatch(/no longer in progress/)
    }
  })
})

describe('caseScopedStorageName', () => {
  it('scopes outputs per case and per upload, keeping the original name last', () => {
    const a = caseScopedStorageName('output', CASE_ID, 'Smith_J.zip')
    const b = caseScopedStorageName('output', CASE_ID, 'Smith_J.zip')
    expect(a).toMatch(new RegExp(`^case-outputs/${CASE_ID}/[0-9a-f-]{36}/Smith_J\\.zip$`))
    expect(a).not.toBe(b) // a re-upload never overwrites the live output
    expect(displayFileName(a)).toBe('Smith_J.zip')
    expect(isValidUploadFileName(a)).toBe(true)
    // ...and never collides with the lab's scan, stored at the plain name
    expect(a).not.toBe('Smith_J.zip')
  })

  it('keeps very long names within the validator limit, extension intact', () => {
    const long = `${'x'.repeat(400)}.stl`
    const name = caseScopedStorageName('preview', CASE_ID, long)
    expect(name.length).toBeLessThanOrEqual(255)
    expect(name.endsWith('.stl')).toBe(true)
    expect(isValidUploadFileName(name)).toBe(true)
  })
})

describe('uploadStorageName', () => {
  it('gives every plain upload its own folder, keeping the original name last', () => {
    const a = uploadStorageName('scan.zip')
    const b = uploadStorageName('scan.zip')
    expect(a).toMatch(/^uploads\/[0-9a-f-]{36}\/scan\.zip$/)
    expect(a).not.toBe(b) // two labs' cases / a chat file named "scan.zip" never share an object
    expect(displayFileName(a)).toBe('scan.zip')
  })

  it('leaves already case-scoped names (outputs, previews, hold images) untouched', () => {
    const output = caseScopedStorageName('output', CASE_ID, 'Smith_J.zip')
    expect(uploadStorageName(output)).toBe(output)
    const hold = `hold-images/${CASE_ID}/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d-photo.jpg`
    expect(uploadStorageName(hold)).toBe(hold)
  })

  it('cannot be requested by a client directly — only the server assigns upload folders', () => {
    expect(isValidUploadFileName(uploadStorageName('scan.zip'))).toBe(false)
  })
})
