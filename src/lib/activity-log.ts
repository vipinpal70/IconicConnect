import { randomUUID } from 'node:crypto'
import { db } from '@/src/db'
import { activityLogs } from '@/src/db/schema/activity-log'
import { cases, type CaseTimelineEvent } from '@/src/db/schema/case'
import type { Profile } from '@/src/db/schema/profile'
import { eq, sql } from 'drizzle-orm'

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
  if (actor.role === 'consultant') return actor.fullName || 'Consultant'
  return actor.fullName || actor.labName || 'System'
}

export function formatActivityLabel(action: string, details: ActivityDetails, actorRole?: string) {
  if (action === 'case.created') return 'Case submitted by client'
  if (action === 'case.file_uploaded') {
    if (actorRole === 'designer') return 'Designer uploaded design'
    return 'Case file uploaded'
  }
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
  if (action === 'client.model_only_lab_updated') return 'Client "3D Model only" restriction updated'
  if (action === 'price_list.updated') return 'Price list updated'
  if (action === 'invoice.created') return 'Invoice created'
  if (action === 'invoice.updated') return 'Invoice updated'
  if (action === 'invoice.deleted') return 'Invoice deleted'
  if (action === 'subuser.created') return 'Sub-user created'
  if (action === 'subuser.updated') return 'Sub-user updated'
  if (action === 'subuser.deleted') return 'Sub-user deleted'
  if (action === 'milling_center.created') return 'Milling centre onboarded'
  if (action === 'milling_center.updated') return 'Milling centre updated'
  if (action === 'milling_center.deactivated') return 'Milling centre deactivated'
  if (action === 'milling_user.created') return 'Milling portal user created'
  if (action === 'milling_user.password_reset') return 'Milling portal user password reset'
  if (action === 'milling_user.deleted') return 'Milling portal user deleted'
  if (action === 'milling_routing_rule.created') return 'Milling routing rule created'
  if (action === 'milling_routing_rule.updated') return 'Milling routing rule updated'
  if (action === 'milling_routing_rule.deleted') return 'Milling routing rule deleted'
  if (action === 'case.milling_assigned') return 'Assigned to milling centre'
  if (action === 'case.milling_status_updated') {
    const status = typeof details?.status === 'string' ? details.status : null
    switch (status) {
      case 'milling_in_progress':
        return 'Milling started'
      case 'milling_qc':
        return 'Milling QC passed'
      case 'dispatched':
        return 'Dispatched by milling centre'
      case 'delivered':
        return 'Delivered by milling centre'
      default:
        return 'Milling status updated'
    }
  }
  if (action === 'case.milling_shipment_recorded') return 'Shipment recorded by milling centre'
  if (action === 'case.milling_file_uploaded') return 'Milling centre uploaded a file'

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
 * Milling-stage events must never surface milling terminology, centre names,
 * or shipment/tracking detail to the dental lab — see the milling
 * implementation plan's client visibility rules. Returns the client-facing
 * override for a given internal action, or null if the event is safe to show as-is.
 */
function getClientTimelineOverride(
  action: string,
  details: ActivityDetails
): { clientLabel?: string; clientHidden?: boolean } | null {
  if (action === 'case.milling_assigned') return { clientLabel: 'Sent to production' }
  if (action === 'case.milling_status_updated') {
    const status = typeof details?.status === 'string' ? details.status : null
    switch (status) {
      case 'dispatched':
        return { clientLabel: 'Shipped by Iconic' }
      default:
        // ready_for_milling / milling_in_progress / milling_qc / delivered all
        // collapse into the coarse "In Production" status client-side already —
        // no extra timeline line needed for these intermediate transitions.
        return { clientHidden: true }
    }
  }
  if (action === 'case.milling_shipment_recorded') return { clientHidden: true }
  if (action === 'case.milling_file_uploaded') return { clientHidden: true }
  return null
}

function buildCaseTimelineEvent({
  actor,
  action,
  details,
}: Omit<LogActivityInput, 'caseId'> & { details?: ActivityDetails }): CaseTimelineEvent {
  return {
    id: randomUUID(),
    action,
    label: formatActivityLabel(action, details ?? null, actor.role),
    actor: formatActivityActor(actor),
    actionAt: new Date().toISOString(),
    ...getClientTimelineOverride(action, details ?? null),
  }
}

export async function logActivity({
  actor,
  action,
  caseId,
  details = null,
}: LogActivityInput) {
  if (caseId) {
    const timelineEvent = buildCaseTimelineEvent({
      actor,
      action,
      details,
    })

    try {
      await db
        .update(cases)
        .set({
          timeline: sql`coalesce(${cases.timeline}, '[]'::jsonb) || ${JSON.stringify([timelineEvent])}::jsonb`,
        })
        .where(eq(cases.id, caseId))
    } catch (error) {
      console.error('Case timeline append failed:', {
        action,
        caseId,
        userId: actor.id,
        error,
      })
    }
  }

  try {
    await db.insert(activityLogs).values({
      caseId: caseId ?? null,
      userId: actor.id,
      userType: actor.userType,
      userRole: actor.role,
      action,
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
