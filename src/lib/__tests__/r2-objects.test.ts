import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/r2', () => ({ r2: { send: vi.fn(async () => ({ Errors: [] })) }, R2_BUCKET: 'test' }))

import { isProtectedKey, deleteKeys } from '../r2-objects'
import { r2 } from '../r2'

describe('protected backup prefix', () => {
  it('recognises backup keys only', () => {
    expect(isProtectedKey('db-backups/iconic_connect_2026-01-01_020000.dump')).toBe(true)
    expect(isProtectedKey('db-backups/local-dev/x.dump.enc')).toBe(true)
    expect(isProtectedKey('Some Lab/scan.stl')).toBe(false)
    expect(isProtectedKey('not-db-backups/x')).toBe(false)
  })

  it('deleteKeys never sends a protected key to R2', async () => {
    const send = vi.mocked(r2.send)
    send.mockClear()
    await deleteKeys(['db-backups/a.dump', 'Lab/file.png', 'db-backups/local-dev/b.dump.enc'])
    const sent = send.mock.calls.flatMap((c) => (c[0] as { input: { Delete: { Objects: { Key: string }[] } } }).input.Delete.Objects.map((o) => o.Key))
    expect(sent).toEqual(['Lab/file.png'])
  })

  it('does not call R2 at all when everything is protected', async () => {
    const send = vi.mocked(r2.send)
    send.mockClear()
    await deleteKeys(['db-backups/only.dump'])
    expect(send).not.toHaveBeenCalled()
  })
})
