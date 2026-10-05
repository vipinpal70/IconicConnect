import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { caseBulkDownloads } from '@/src/db/schema/bulk-download'
import { profiles } from '@/src/db/schema/profile'
import { invalidateCasesCache, deleteCachedData } from '@/src/lib/redis-cache'
import type { AuthedProfile, DownloadScope, InternalInclude } from './types'

/** A claim that never finished (crash / killed process) stops blocking the case after this long. */
const STALE_CLAIM_MS = 2 * 60 * 60 * 1000

export type LatestCompleted = {
  completedAt: Date
  fingerprints: string[]
  downloadedBy: string | null
  downloadedByName: string | null
  downloadedByRole: string | null
}


/** Latest completed (not reset) download per case for a scope. */
export async function getLatestCompleted(caseIds: string[], scope: DownloadScope): Promise<Map<string, LatestCompleted>> {
  const map = new Map<string, LatestCompleted>()
  if (caseIds.length === 0) return map
  const rows = await db
    .selectDistinctOn([caseBulkDownloads.caseId], {
      caseId: caseBulkDownloads.caseId,
      completedAt: caseBulkDownloads.completedAt,
      fingerprints: caseBulkDownloads.fingerprints,
      downloadedBy: caseBulkDownloads.downloadedBy,
      downloadedByRole: caseBulkDownloads.downloadedByRole,
      downloadedByName: profiles.fullName,
      downloadedByEmail: profiles.email,
    })
    .from(caseBulkDownloads)
    .leftJoin(profiles, eq(caseBulkDownloads.downloadedBy, profiles.id))
    .where(and(
      inArray(caseBulkDownloads.caseId, caseIds),
      eq(caseBulkDownloads.scope, scope),
      eq(caseBulkDownloads.status, 'completed'),
    ))
    .orderBy(caseBulkDownloads.caseId, desc(caseBulkDownloads.completedAt))
  for (const r of rows) {
    if (!r.completedAt) continue
    map.set(r.caseId, {
      completedAt: r.completedAt,
      fingerprints: r.fingerprints ?? [],
      downloadedBy: r.downloadedBy,
      downloadedByName: r.downloadedByName || r.downloadedByEmail || null,
      downloadedByRole: r.downloadedByRole,
    })
  }
  return map
}

/**
 * Claim cases for a download. The partial unique index (one `in_progress` row per case+scope) makes a second
 * concurrent download of the same case fail to claim — it comes back absent from the returned map.
 */
export async function claimCases(
  profile: AuthedProfile,
  scope: DownloadScope,
  rows: Array<{ id: string; clientId: string }>,
  include: InternalInclude | null,
): Promise<Map<string, string>> {
  const claimed = new Map<string, string>()
  if (rows.length === 0) return claimed

  // Self-heal: expire abandoned claims for these cases before trying to take them.
  await db
    .update(caseBulkDownloads)
    .set({ status: 'failed', failureReason: 'stale_claim' })
    .where(and(
      inArray(caseBulkDownloads.caseId, rows.map((r) => r.id)),
      eq(caseBulkDownloads.scope, scope),
      eq(caseBulkDownloads.status, 'in_progress'),
      lt(caseBulkDownloads.startedAt, new Date(Date.now() - STALE_CLAIM_MS)),
    ))

  const inserted = await db
    .insert(caseBulkDownloads)
    .values(rows.map((r) => ({
      caseId: r.id,
      clientId: r.clientId,
      scope,
      status: 'in_progress' as const,
      downloadedBy: profile.id,
      downloadedByRole: profile.role,
      include: include ? { ...include } : null,
    })))
    .onConflictDoNothing()
    .returning({ id: caseBulkDownloads.id, caseId: caseBulkDownloads.caseId })
  for (const r of inserted) claimed.set(r.caseId, r.id)
  return claimed
}

/** Mark a claim completed and update the cases cache column atomically. */
export async function completeClaim(
  claimId: string,
  info: { caseId: string; clientId: string; scope: DownloadScope; filesDelivered: number; bytesDelivered: number; signature: string; fingerprints: string[] },
): Promise<void> {
  const at = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(caseBulkDownloads)
      .set({
        status: 'completed',
        completedAt: at,
        filesDelivered: info.filesDelivered,
        bytesDelivered: info.bytesDelivered,
        contentSignature: info.signature,
        fingerprints: info.fingerprints,
      })
      .where(eq(caseBulkDownloads.id, claimId))
    await tx
      .update(cases)
      .set(info.scope === 'client_output' ? { clientOutputDownloadedAt: at } : { internalFilesDownloadedAt: at })
      .where(eq(cases.id, info.caseId))
  })
  await Promise.all([
    invalidateCasesCache(info.clientId).catch(() => {}),
    deleteCachedData(`case:detail:${info.caseId}`).catch(() => {}),
  ])
}

export async function failClaim(claimId: string, reason: string): Promise<void> {
  await db
    .update(caseBulkDownloads)
    .set({ status: 'failed', failureReason: reason.slice(0, 500) })
    .where(and(eq(caseBulkDownloads.id, claimId), eq(caseBulkDownloads.status, 'in_progress')))
}

/** Admin override: void earlier completed downloads and clear the cache column(s). */
export async function resetCaseDownloads(
  caseId: string,
  scope: DownloadScope | 'both',
  admin: AuthedProfile,
): Promise<{ clientId: string } | null> {
  const [row] = await db.select({ id: cases.id, clientId: cases.clientId }).from(cases).where(eq(cases.id, caseId)).limit(1)
  if (!row) return null
  const scopes: DownloadScope[] = scope === 'both' ? ['client_output', 'internal_files'] : [scope]
  await db.transaction(async (tx) => {
    for (const s of scopes) {
      await tx
        .update(caseBulkDownloads)
        .set({ status: 'reset' })
        .where(and(eq(caseBulkDownloads.caseId, caseId), eq(caseBulkDownloads.scope, s), eq(caseBulkDownloads.status, 'completed')))
      await tx.insert(caseBulkDownloads).values({
        caseId,
        clientId: row.clientId,
        scope: s,
        status: 'reset',
        downloadedBy: admin.id,
        downloadedByRole: admin.role,
        completedAt: new Date(),
      })
      await tx.update(cases).set(s === 'client_output' ? { clientOutputDownloadedAt: null } : { internalFilesDownloadedAt: null }).where(eq(cases.id, caseId))
    }
  })
  await Promise.all([
    invalidateCasesCache(row.clientId).catch(() => {}),
    deleteCachedData(`case:detail:${caseId}`).catch(() => {}),
  ])
  return { clientId: row.clientId }
}

