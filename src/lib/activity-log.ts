import { db } from '@/src/db'
import { activityLogs } from '@/src/db/schema/activity-log'
import type { Profile } from '@/src/db/schema/profile'

type ActivityDetails = Record<string, unknown> | null

type ActivityActor = Pick<Profile, 'id' | 'userType' | 'role'>

type LogActivityInput = {
  actor: ActivityActor
  action: string
  caseId?: string | null
  details?: ActivityDetails
}

export async function logActivity({
  actor,
  action,
  caseId,
  details = null,
}: LogActivityInput) {
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
