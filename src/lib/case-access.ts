import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCaseAssignments } from '@/src/db/schema/milling'
import type { CaseTimelineEvent } from '@/src/db/schema/case'
import type { Profile } from '@/src/db/schema/profile'

/**
 * Milling-centre accounts are third-party partners. They may only touch cases that are assigned to
 * THEIR centre (design leg or production leg). Returns a 404 response when not assigned (so case ids
 * can't be probed), or null when access is fine / the caller isn't a milling account.
 */
export async function denyUnlessMillingAssigned(
  profile: Pick<Profile, 'userType' | 'millingCenterId'>,
  caseId: string,
): Promise<NextResponse | null> {
  if (profile.userType !== 'milling_portal') return null
  if (!profile.millingCenterId) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }
  const [assignment] = await db
    .select({
      designCenterId: millingCaseAssignments.designCenterId,
      productionCenterId: millingCaseAssignments.productionCenterId,
    })
    .from(millingCaseAssignments)
    .where(eq(millingCaseAssignments.caseId, caseId))
    .limit(1)
  const mine =
    assignment &&
    (assignment.designCenterId === profile.millingCenterId ||
      assignment.productionCenterId === profile.millingCenterId)
  return mine ? null : NextResponse.json({ error: 'Case not found' }, { status: 404 })
}

/**
 * Server-side version of the client timeline view: drops events hidden from the lab and swaps in the
 * client-facing label. Previously only the UI did this, so the raw API response exposed milling
 * terminology and internal audit events to clients.
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
  const { internalFilesDownloadedAt: _internal, internalFilesDownloadedBy: _by, ...rest } = row as Record<string, unknown>
  return rest as T
}

export const isLabRole = (role: string) => role === 'client' || role === 'subuser'
