import { eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { caseDetails, type Case } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { pickPerCase } from '@/src/lib/files-repo'
import { getCaseTimeline } from '@/src/lib/activity-log'

/**
 * Case-detail payload in the shape the UI already consumes. The hot `cases` row is joined with its cold
 * `case_details`, the design/preview/teeth-library files, staff names and the timeline (from activity_logs),
 * all in ONE parallel step: 4 queries total, no matter how many staff are assigned.
 */
export async function buildCaseDetail(c: Case) {
  const staffIds = [c.designerId, c.qcId, c.accountManagerId, c.createdById].filter((v): v is string => Boolean(v))
  const [detail, staff, outputs, previews, teeth, timeline] = await Promise.all([
    db.select().from(caseDetails).where(eq(caseDetails.caseId, c.id)).limit(1).then((r) => r[0]),
    staffIds.length
      ? db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).where(inArray(profiles.id, staffIds))
      : Promise.resolve([] as { id: string; fullName: string | null }[]),
    pickPerCase([c.id], 'output', 'latest'),
    pickPerCase([c.id], 'preview', 'latest'),
    pickPerCase([c.id], 'teeth_library', 'latest'),
    getCaseTimeline(c.id),
  ])
  const name = new Map(staff.map((s) => [s.id, s.fullName]))
  const n = (id: string | null) => (id ? name.get(id) || null : null)
  return {
    ...c,
    designerName: n(c.designerId),
    qcName: n(c.qcId),
    accountManagerName: n(c.accountManagerId),
    createdBy: n(c.createdById),
    approvalChecklist: detail?.approvalChecklist ?? [],
    outputNote: detail?.outputNote ?? null,
    clientMassage: detail?.clientMessage ?? null, // legacy response key (UI contract)
    outputFile: outputs.get(c.id)?.fileUrl ?? null,
    previewFile: previews.get(c.id)?.fileUrl ?? null,
    teethLibraryFileUrl: teeth.get(c.id)?.fileUrl ?? null,
    teethLibraryFileName: teeth.get(c.id)?.fileName ?? null,
    timeline,
  }
}
