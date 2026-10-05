import { describe, it, expect, vi } from 'vitest'

vi.mock('@/src/lib/r2-objects', () => ({
  keyFromProxyUrl: (url: string) => {
    const q = url.indexOf('?')
    if (q === -1 || !url.slice(0, q).endsWith('/api/cases/files')) return null
    const p = new URLSearchParams(url.slice(q + 1))
    const l = p.get('labName'), f = p.get('fileName')
    return l && f ? `${l}/${f}` : null
  },
}))

import { escapeHtml } from '../html'
import { validatePasswordStrength } from '../password'
import { getClientIp } from '../client-ip'
import { isValidUploadFileName } from '../file-name'
import { isSafeStoredFileUrl } from '../safe-url'

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml('<img src=x onerror="a()">')).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt;')
  })
})

describe('validatePasswordStrength', () => {
  it('rejects short, common and single-class passwords', () => {
    expect(validatePasswordStrength('Ab1!')).toMatch(/at least/)
    expect(validatePasswordStrength('password123')).toBeTruthy()
    expect(validatePasswordStrength('alllowercaseletters')).toMatch(/three/)
  })
  it('accepts a strong one', () => {
    expect(validatePasswordStrength('Correct-Horse-9')).toBeNull()
  })
})

describe('getClientIp', () => {
  it('prefers infrastructure headers and ignores a spoofed first XFF hop', () => {
    expect(getClientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.1.1.1')
    expect(getClientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 2.2.2.2' }))).toBe('2.2.2.2')
    expect(getClientIp(new Headers())).toBe('unknown')
  })
})

describe('isValidUploadFileName', () => {
  it('allows plain names only', () => {
    expect(isValidUploadFileName('scan 01.stl')).toBe(true)
    for (const bad of ['', '..', 'a/b.stl', 'a\\b.stl', '../x', 'x\u0000.stl']) expect(isValidUploadFileName(bad)).toBe(false)
  })
})

describe('isSafeStoredFileUrl', () => {
  const ok = '/api/cases/files?labName=Lab%20A&fileName=x.stl'
  it('accepts our proxy URL for the expected lab only', () => {
    expect(isSafeStoredFileUrl(ok)).toBe(true)
    expect(isSafeStoredFileUrl(ok, { expectedLabName: 'Lab A' })).toBe(true)
    expect(isSafeStoredFileUrl(ok, { expectedLabName: 'Other Lab' })).toBe(false)
  })
  it('rejects dangerous or foreign URLs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'https://evil.example/x', 'http://169.254.169.254/latest', '//evil.example/x', '/etc/passwd', '', null, 42]) {
      expect(isSafeStoredFileUrl(bad)).toBe(false)
    }
  })
})
