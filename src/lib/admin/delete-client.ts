import { and, eq, inArray, or } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { cases } from '@/src/db/schema/case'
import { invoices } from '@/src/db/schema/invoice'
import { supportTickets } from '@/src/db/schema/support-ticket'
import { supportCallbackRequests } from '@/src/db/schema/support-callback-request'
import { activityLogs } from '@/src/db/schema/activity-log'
import { deleteUser } from '@/src/lib/auth/auth-service'

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
 * cascade on profiles.id; chat_messages/chat_read_states cascade on cases.id) is deleted here
 * explicitly, in dependency order, inside one transaction — so a client is
 * either fully gone or the delete fails with nothing changed. Supabase Auth
 * accounts are only removed after that transaction commits, so a failed
 * cascade never leaves a login without a profile (the inverse of the old
 * bug, which deleted Auth first).
 */
export async function deleteClientCompletely(clientId: string): Promise<DeleteClientResult> {
  const subUserRows = await db
    .select({ profileId: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.clientId, clientId), eq(profiles.role, 'subuser')))
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

    // chat, files, case_details, bulk-download rows and activity cascade from the cases (FK ON DELETE CASCADE).
    // Invoices go first: invoice_cases -> cases is RESTRICT by design, so a billed case can't vanish silently.
    await tx.delete(invoices).where(eq(invoices.clientId, clientId))

    await tx.delete(supportTickets).where(eq(supportTickets.clientId, clientId))
    await tx.delete(supportCallbackRequests).where(eq(supportCallbackRequests.clientId, clientId))
    if (caseIds.length > 0) {
      await tx.delete(cases).where(eq(cases.clientId, clientId))
    }

    if (subUserProfileIds.length > 0) {
      await tx.delete(profiles).where(inArray(profiles.id, subUserProfileIds))
    }

    await tx.delete(profiles).where(eq(profiles.id, clientId))
  })

  const authDeleteErrors: { id: string; error: string }[] = []
  // Remove logins last (profiles are already gone); revokes any live sessions.
  for (const id of allProfileIds) {
    try { await deleteUser(id) } catch (e) { authDeleteErrors.push({ id, error: e instanceof Error ? e.message : String(e) }) }
  }

  return {
    clientId,
    subUserProfileIds,
    casesDeleted: caseIds.length,
    authDeleteErrors,
  }
}
