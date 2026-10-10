import { db } from '@/src/db'
import { activityLogs } from '@/src/db/schema/activity-log'
import type { CaseTimelineEvent } from '@/src/db/schema/case'
import type { Profile } from '@/src/db/schema/profile'
import { asc, eq } from 'drizzle-orm'

export type ActivityDetails = Record<string, unknown> | null

type ActivityActor = Pick<
  Profile,
  'id' | 'userType' | 'role' | 'fullName' | 'labName'
>

type LogActivityInput = {
  actor: ActivityActor
  action: string
  caseId?: string | null
  details?: ActivityDetails
}

export function formatActivityActor(actor: Pick<Profile, 'fullName' | 'labName' | 'role'>) {
  if (actor.role === 'client') return actor.labName || actor.fullName || 'Client'
  if (actor.role === 'subuser') return actor.fullName || 'Subuser'
  if (actor.role === 'admin') return actor.fullName || 'Super Admin'
  if (actor.role === 'qc') return `QC${actor.fullName ? ` — ${actor.fullName}` : ''}`
  if (actor.role === 'designer') return actor.fullName || 'Designer'
  if (actor.role === 'account_manager') return actor.fullName || 'Account Manager'
  return actor.fullName || actor.labName || 'System'
}

export function formatActivityLabel(action: string, details: ActivityDetails, actorRole?: string) {
  if (action === 'case.created') return 'Case submitted by client'
  if (action === 'case.xml_extracted') return '3Shape packages extracted for review'
  if (action === 'case.file_uploaded') {
    if (actorRole === 'designer') return 'Designer uploaded design'
    return 'Case file uploaded'
  }
  if (action === 'case.preview_file_uploaded') return 'Preview file uploaded'
  if (action === 'case.preview_file_deleted') return 'Preview file removed'
  if (action === 'case.hold_files_uploaded') return 'Hold images attached'
  if (action === 'case.hold_file_deleted') return 'Hold image removed'
  if (action === 'offer.created') return 'Offer created'
  if (action === 'offer.updated') return 'Offer updated'
  if (action === 'offer.deleted') return 'Offer deleted'
  if (action === 'tutorial.created') return 'Tutorial created'
  if (action === 'tutorial.deleted') return 'Tutorial deleted'
  if (action === 'support_ticket.created') return 'Support ticket submitted'
  if (action === 'support_ticket.updated') return 'Support ticket updated'
  if (action === 'support_callback.created') return 'Callback requested'
  if (action === 'preference_form.created') return 'Preference form created'
  if (action === 'preference_form.updated') return 'Preference form updated'
  if (action === 'preference_form.deleted') return 'Preference form deleted'
  if (action === 'client.registered') return 'Client registered'
  if (action === 'client.approved') return 'Client account approved'
  if (action === 'client.plan_updated') return 'Client plan updated'
  if (action === 'client.deactivated') return 'Client account deactivated'
  if (action === 'client.activated') return 'Client account reactivated'
  if (action === 'client.deleted') return 'Client account deleted'
  if (action === 'client.model_only_lab_updated') return 'Legacy: client "3D Model only" restriction updated'
  if (action === 'price_list.updated') return 'Price list updated'
  if (action === 'invoice.created') return 'Invoice created'
  if (action === 'invoice.updated') return 'Invoice updated'
  if (action === 'invoice.deleted') return 'Invoice deleted'
  if (action === 'subuser.created') return 'Sub-user created'
  if (action === 'subuser.updated') return 'Sub-user updated'
  if (action === 'subuser.deleted') return 'Sub-user deleted'
  if (action === 'case.converted_to_design_only') return 'Converted to Design Only'
  // Events recorded before the milling flow was removed stay readable in old timelines.
  if (/^(case\.)?milling_/.test(action)) return 'Legacy milling event'
  if (action === 'case.bulk_download_started') return 'Bulk download started'
  if (action === 'case.bulk_download_completed') return 'Bulk download completed'
  if (action === 'case.bulk_download_failed') return 'Bulk download failed'
  if (action === 'bulk_download.rejected') return 'Bulk download rejected'
  if (action === 'case.bulk_download_reset') return 'Bulk download status reset'

  if (action === 'case.updated') {
    const changes = (details?.changes as Record<string, unknown> | undefined) || {}
    const nextStatus = typeof changes.status === 'string' ? changes.status : null

    switch (nextStatus) {
      case 'scan_verified':
        return 'Scan validated'
      case 'allocated_to_designer':
        return 'Allocated to designer'
      case 'in_progress':
        return 'Designer started working'
      case 'internal_qc':
        return 'Design submitted to internal QC'
      case 'submitted_to_client':
        return 'Submitted for client approval'
      case 'approved':
      case 'delivered':
        return 'Client approved · Delivered'
      case 'client_feedback':
        return 'Client requested changes'
      case 'change_requested':
        return 'Client requested changes'
      case 'client_reject':
        return 'Client rejected design'
      case 'cancelled':
        return 'Case cancelled'
      case 'on_hold':
      case 'scan_not_verified':
        return 'Case put on hold'
      default:
        return 'Case details updated'
    }
  }

  return action.replace(/\./g, ' ')
}

/**
 * Client-facing override for a given internal action, or null if the event is
 * safe to show as-is.
 */
function getClientTimelineOverride(
  action: string,
  details: ActivityDetails
): { clientLabel?: string; clientHidden?: boolean } | null {
  // Legacy milling events (recorded before the flow was removed) are never shown to labs.
  if (/^(case\.)?milling_/.test(action)) return { clientHidden: true }
  // Internal-team downloads of the lab's files are an internal audit trail only;
  // the client sees just their own output downloads.
  if (action.startsWith('case.bulk_download_') && details?.scope !== 'client_output') {
    return { clientHidden: true }
  }
  return null
}

/**
 * One insert per event. The same row is the audit trail AND the case timeline (the old design also
 * rewrote the whole `cases.timeline` jsonb on every event — row bloat + a hot-row write per update).
 */
export async function logActivity({
  actor,
  action,
  caseId,
  details = null,
}: LogActivityInput) {
  const override = getClientTimelineOverride(action, details ?? null)
  try {
    await db.insert(activityLogs).values({
      caseId: caseId ?? null,
      userId: actor.id,
      userType: actor.userType,
      userRole: actor.role,
      actorName: formatActivityActor(actor),
      action,
      label: formatActivityLabel(action, details ?? null, actor.role),
      clientLabel: override?.clientLabel ?? null,
      clientVisible: !override?.clientHidden,
      details,
    })
  } catch (error) {
    console.error('Activity log insert failed:', {
      action,
      caseId: caseId ?? null,
      userId: actor.id,
      error,
    })
  }
}

/** Case timeline in the shape the UI already consumes (idx_activity_case_time). */
export async function getCaseTimeline(caseId: string): Promise<CaseTimelineEvent[]> {
  const rows = await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      label: activityLogs.label,
      actor: activityLogs.actorName,
      actionAt: activityLogs.actionAt,
      clientLabel: activityLogs.clientLabel,
      clientVisible: activityLogs.clientVisible,
    })
    .from(activityLogs)
    .where(eq(activityLogs.caseId, caseId))
    .orderBy(asc(activityLogs.actionAt))
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    label: r.label ?? r.action,
    actor: r.actor ?? 'System',
    actionAt: r.actionAt.toISOString(),
    ...(r.clientLabel ? { clientLabel: r.clientLabel } : {}),
    ...(r.clientVisible ? {} : { clientHidden: true }),
  }))
}
