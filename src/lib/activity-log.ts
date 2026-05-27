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

export function formatActivityLabel(action: string, details: ActivityDetails) {
  if (action === 'case.created') {
    return 'Case submitted by client'
  }

  if (action === 'case.file_uploaded') {
    return 'Case file uploaded'
  }

  if (action === 'case.updated') {
    const changes = (details?.changes as Record<string, unknown> | undefined) || {}
    const nextStatus = typeof changes.status === 'string' ? changes.status : null

    switch (nextStatus) {
      case 'scan_verified':
        return 'Scan validated'
      case 'allocated_to_designer':
      case 'in_progress':
        return 'Allocated to designer'
      case 'internal_qc':
        return 'Design submitted to internal QC'
      case 'submitted_to_client':
        return 'Submitted for client approval'
      case 'approved':
      case 'delivered':
        return 'Client approved · Delivered'
      case 'client_feedback':
        return 'Client requested changes'
      case 'on_hold':
      case 'scan_not_verified':
        return 'Case put on hold'
      default:
        return 'Case details updated'
    }
  }

  return action.replace(/\./g, ' ')
}

function buildCaseTimelineEvent({
  actor,
  action,
  details,
}: Omit<LogActivityInput, 'caseId'> & { details?: ActivityDetails }): CaseTimelineEvent {
  return {
    id: randomUUID(),
    action,
    label: formatActivityLabel(action, details ?? null),
    actor: formatActivityActor(actor),
    actionAt: new Date().toISOString(),
    actionTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
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
