import { eq, inArray, or } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, subUsers } from '@/src/db/schema/profile'
import {
  cases,
  caseMessages,
  caseFiles,
  casePreviewFiles,
  caseReferenceFiles,
  caseHoldFiles,
} from '@/src/db/schema/case'
import { invoices } from '@/src/db/schema/invoice'
import { supportTickets } from '@/src/db/schema/support-ticket'
import { supportCallbackRequests } from '@/src/db/schema/support-callback-request'
import { activityLogs } from '@/src/db/schema/activity-log'
import { supabaseAdmin } from '@/src/lib/supabase/admin'

export interface DeleteClientResult {
  clientId: string
  subUserProfileIds: string[]
  casesDeleted: number
  authDeleteErrors: { id: string; error: string }[]
}

/**
 * Permanently removes a client (and every sub-user under them) from the
 * database and from Supabase Auth. Everything that isn't already covered by
 * an `onDelete: 'cascade'` FK (notifications, notification_preferences,
 * sidebar_seen_at, client_price_list, preference_forms, offer_claims — all
 * cascade on profiles.id; chat_messages/chat_read_states/milling_case_assignments/
 * case_center_assignment_history all cascade on cases.id) is deleted here
 * explicitly, in dependency order, inside one transaction — so a client is
 * either fully gone or the delete fails with nothing changed. Supabase Auth
 * accounts are only removed after that transaction commits, so a failed
 * cascade never leaves a login without a profile (the inverse of the old
 * bug, which deleted Auth first).
 */
export async function deleteClientCompletely(clientId: string): Promise<DeleteClientResult> {
  const subUserRows = await db
    .select({ profileId: subUsers.profileId })
    .from(subUsers)
    .where(eq(subUsers.clientId, clientId))
  const subUserProfileIds = subUserRows.map((r) => r.profileId)
  const allProfileIds = [clientId, ...subUserProfileIds]

  const caseRows = await db.select({ id: cases.id }).from(cases).where(eq(cases.clientId, clientId))
  const caseIds = caseRows.map((r) => r.id)

  await db.transaction(async (tx) => {
    await tx
      .delete(activityLogs)
      .where(
        caseIds.length > 0
          ? or(inArray(activityLogs.caseId, caseIds), inArray(activityLogs.userId, allProfileIds))
          : inArray(activityLogs.userId, allProfileIds)
      )

    if (caseIds.length > 0) {
      await tx.delete(caseMessages).where(inArray(caseMessages.caseId, caseIds))
      await tx.delete(caseFiles).where(inArray(caseFiles.caseId, caseIds))
      await tx.delete(casePreviewFiles).where(inArray(casePreviewFiles.caseId, caseIds))
      await tx.delete(caseReferenceFiles).where(inArray(caseReferenceFiles.caseId, caseIds))
      await tx.delete(caseHoldFiles).where(inArray(caseHoldFiles.caseId, caseIds))
    }

    await tx.delete(supportTickets).where(eq(supportTickets.clientId, clientId))
    await tx.delete(supportCallbackRequests).where(eq(supportCallbackRequests.clientId, clientId))
    await tx.delete(invoices).where(eq(invoices.clientId, clientId))

    if (caseIds.length > 0) {
      await tx.delete(cases).where(eq(cases.clientId, clientId))
    }

    await tx.delete(subUsers).where(eq(subUsers.clientId, clientId))

    if (subUserProfileIds.length > 0) {
      await tx.delete(profiles).where(inArray(profiles.id, subUserProfileIds))
    }

    await tx.delete(profiles).where(eq(profiles.id, clientId))
  })

  const authDeleteErrors: { id: string; error: string }[] = []
  for (const id of allProfileIds) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
    if (error && !/not.*found/i.test(error.message)) {
      authDeleteErrors.push({ id, error: error.message })
    }
  }

  return {
    clientId,
    subUserProfileIds,
    casesDeleted: caseIds.length,
    authDeleteErrors,
  }
}
