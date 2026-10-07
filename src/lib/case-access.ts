import type { CaseTimelineEvent } from '@/src/db/schema/case'

/**
 * Server-side version of the client timeline view: drops events hidden from the lab and swaps in the
 * client-facing label. Previously only the UI did this, so the raw API response exposed internal
 * audit events to clients.
 */
export function timelineForClient(timeline: unknown): CaseTimelineEvent[] {
  if (!Array.isArray(timeline)) return []
  return (timeline as CaseTimelineEvent[])
    .filter((e) => !e.clientHidden)
    .map((e) => (e.clientLabel ? { ...e, label: e.clientLabel } : e))
    .map(({ clientLabel: _cl, clientHidden: _ch, ...rest }) => rest as CaseTimelineEvent)
}

/**
 * Bulk-download tracking: the lab may see ITS download flag, but never that/when Iconic staff downloaded its
 * files. Strip the staff-only field from every lab-role case payload.
 */
export function stripStaffOnlyCaseFields<T extends Record<string, unknown>>(row: T, role: string): T {
  if (role !== 'client' && role !== 'subuser') return row
  const { internalFilesDownloadedAt: _internal, internalFilesDownloadedBy: _by, clientOutputDownloadedBy: _cby, ...rest } = row as Record<string, unknown>
  return rest as T
}

export const isLabRole = (role: string) => role === 'client' || role === 'subuser'
