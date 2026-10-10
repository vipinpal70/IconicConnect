import { inArray, or, eq, like, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { files } from '@/src/db/schema/files'
import { notifications } from '@/src/db/schema/notification'
import { caseCleanupQueue, connection } from './client'
import { deleteKeys } from '../r2-objects'

/**
 * Case deletion is split in two on purpose:
 *   1. the request deletes the case row (one transaction; everything else cascades) and returns immediately;
 *   2. THIS job removes the things that are slow or can fail independently — R2 objects and stale notifications.
 * The user never waits on object storage, and an R2 outage can never make "delete case" fail or half-apply.
 */

export type CaseCleanupJob = {
  caseId: string
  caseNumber: string | null
  /** R2 keys that belonged to the deleted case's files (scan/preview/reference/hold/output/chat/...). */
  keys: string[]
}

const KEYS_PER_JOB = 2000 // keeps Redis payloads small; ~2 DeleteObjects calls per job

/** Fire-and-forget. Never throws: if Redis is down the orphan sweep (r2-cleanup) still reclaims the objects. */
export async function enqueueCaseCleanup(job: CaseCleanupJob): Promise<void> {
  // The queue connection retries forever by design; never let a request-path caller wait on it.
  if (connection.status !== 'ready') { console.error('[case-cleanup] Redis not ready — skipping enqueue; the orphan sweep will reclaim the objects'); return }
  try {
    const keys = job.keys.filter((k) => !/^https?:\/\//i.test(k)) // legacy absolute URLs are not R2 keys
    const chunks: string[][] = []
    for (let i = 0; i < keys.length; i += KEYS_PER_JOB) chunks.push(keys.slice(i, i + KEYS_PER_JOB))
    if (chunks.length === 0) chunks.push([]) // still run the notification cleanup
    await caseCleanupQueue.addBulk(
      chunks.map((c, i) => ({
        name: 'cleanup',
        data: { ...job, keys: c } satisfies CaseCleanupJob,
        opts: { jobId: `case-cleanup-${job.caseId}-${i}` }, // idempotent: a double-clicked delete queues once
      })),
    )
  } catch (err) {
    console.error('[case-cleanup] enqueue failed — objects will be reclaimed by the orphan sweep:', (err as Error).message)
  }
}

type Deps = { deleteKeys: (keys: string[]) => Promise<number> }

export async function processCaseCleanup(
  data: CaseCleanupJob,
  deps: Deps = { deleteKeys },
): Promise<{ notificationsRemoved: number; objectsRequested: number; objectsKept: number }> {
  // Stale notifications for the case (links / metadata). Off the request path because the LIKE scan is not indexed.
  const removed = await db.delete(notifications).where(or(
    eq(notifications.link, `/cases/${data.caseId}`),
    eq(notifications.link, `/admin/cases/${data.caseId}`),
    like(notifications.link, `%/cases/${data.caseId}%`),
    sql`${notifications.metadata}->>'caseId' = ${data.caseId}`,
  )).returning({ id: notifications.id })

  // One R2 object can back several logical files (see migration 1700). Never delete an object that another
  // surviving row still points at — re-checked HERE (not at enqueue time) so late re-uploads are respected.
  let toDelete: string[] = []
  if (data.keys.length > 0) {
    const stillUsed = new Set((await db.select({ k: files.r2Key }).from(files).where(inArray(files.r2Key, data.keys))).map((r) => r.k))
    toDelete = data.keys.filter((k) => !stillUsed.has(k))
    if (toDelete.length > 0) {
      const deleted = await deps.deleteKeys(toDelete) // throws/returns short on failure -> BullMQ retries with backoff
      if (deleted < toDelete.length) throw new Error(`R2 deleted ${deleted}/${toDelete.length} objects; retrying`)
    }
  }
  return { notificationsRemoved: removed.length, objectsRequested: toDelete.length, objectsKept: data.keys.length - toDelete.length }
}
