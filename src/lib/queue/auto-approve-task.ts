import 'dotenv/config'
import { db } from '../../db'
import { cases } from '../../db/schema/case'
import { profiles } from '../../db/schema/profile'
import { eq, and, lte, isNotNull } from 'drizzle-orm'
import { NotificationService } from '../notifications/notification-service'
import { NotificationType } from '../notifications/notification-events'

const AUTO_APPROVE_DAYS = 7

export async function runAutoApprove() {
  console.log('[AutoApprove] Starting auto-approval check...')

  const threshold = new Date()
  threshold.setDate(threshold.getDate() - AUTO_APPROVE_DAYS)

  const pendingCases = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.status, 'submitted_to_client'),
        isNotNull(cases.submittedToClientAt),
        lte(cases.submittedToClientAt, threshold)
      )
    )

  console.log(`[AutoApprove] Found ${pendingCases.length} case(s) eligible for auto-approval.`)

  for (const c of pendingCases) {
    try {
      await db
        .update(cases)
        .set({
          status: 'approved',
          autoApproved: true,
          deliveredTime: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(cases.id, c.id))

      console.log(`[AutoApprove] Auto-approved case ${c.caseNumber} (${c.id})`)

      const caseUrl = `/cases/${c.id}`
      const caseLabel = c.caseNumber ? `Case ${c.caseNumber}` : 'A case'

      // Notify client — use clientId as both actor and target for system event
      NotificationService.dispatch({
        type: NotificationType.CASE_APPROVED,
        actorUserId: c.clientId,
        targetUserId: c.clientId,
        entityId: c.id,
        entityType: 'case',
        title: 'Case Auto-Approved',
        message: `${caseLabel} was automatically approved after 7 days with no action.`,
        link: `/client/cases/${c.id}`,
      }).catch(err => console.error(`[AutoApprove] Client notification failed for ${c.id}:`, err))

      // Notify designer if assigned
      if (c.designerId) {
        NotificationService.dispatch({
          type: NotificationType.CASE_APPROVED,
          actorUserId: c.clientId,
          targetUserId: c.designerId,
          entityId: c.id,
          entityType: 'case',
          title: 'Case Auto-Approved',
          message: `${caseLabel} was automatically approved — client did not respond within 7 days.`,
          link: caseUrl,
        }).catch(err => console.error(`[AutoApprove] Designer notification failed for ${c.id}:`, err))
      }

      // Notify QC if assigned
      if (c.qcId && c.qcId !== c.designerId) {
        NotificationService.dispatch({
          type: NotificationType.CASE_APPROVED,
          actorUserId: c.clientId,
          targetUserId: c.qcId,
          entityId: c.id,
          entityType: 'case',
          title: 'Case Auto-Approved',
          message: `${caseLabel} was automatically approved — client did not respond within 7 days.`,
          link: caseUrl,
        }).catch(err => console.error(`[AutoApprove] QC notification failed for ${c.id}:`, err))
      }

      // Notify admin — find one admin to notify
      const [admin] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.role, 'admin'))
        .limit(1)

      if (admin) {
        NotificationService.dispatch({
          type: NotificationType.CASE_APPROVED,
          actorUserId: c.clientId,
          targetUserId: admin.id,
          entityId: c.id,
          entityType: 'case',
          title: 'Case Auto-Approved',
          message: `${caseLabel} was automatically approved after 7 days with no client response.`,
          link: `/admin/cases/${c.id}`,
        }).catch(err => console.error(`[AutoApprove] Admin notification failed for ${c.id}:`, err))
      }
    } catch (err) {
      console.error(`[AutoApprove] Failed to auto-approve case ${c.id}:`, err)
    }
  }

  console.log('[AutoApprove] Done.')
}

if (require.main === module) {
  runAutoApprove().then(() => process.exit(0)).catch(err => {
    console.error('[AutoApprove] Fatal error:', err)
    process.exit(1)
  })
}
