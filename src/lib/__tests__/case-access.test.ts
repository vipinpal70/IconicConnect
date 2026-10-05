import { describe, it, expect, vi } from 'vitest'
vi.mock('@/src/db', () => ({ db: {} }))
vi.mock('@/src/db/schema/milling', () => ({ millingCaseAssignments: {} }))
import { stripStaffOnlyCaseFields } from '../case-access'

describe('stripStaffOnlyCaseFields', () => {
  const row = { id: 'c1', clientOutputDownloadedAt: 'x', internalFilesDownloadedAt: 'y', internalFilesDownloadedBy: 'Sam' }
  it('removes staff-only download fields for lab roles', () => {
    for (const role of ['client', 'subuser']) {
      const out = stripStaffOnlyCaseFields(row, role) as Record<string, unknown>
      expect(out.internalFilesDownloadedAt).toBeUndefined()
      expect(out.internalFilesDownloadedBy).toBeUndefined()
      expect(out.clientOutputDownloadedAt).toBe('x')
    }
  })
  it('keeps everything for staff', () => {
    expect(stripStaffOnlyCaseFields(row, 'admin')).toEqual(row)
  })
})
