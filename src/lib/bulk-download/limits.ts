import { connection } from '@/src/lib/queue/client'

export const MAX_CASES_PER_DOWNLOAD = 20
export const MAX_TOTAL_BYTES = (Number(process.env.BULK_DOWNLOAD_MAX_BYTES) || 10 * 1024 * 1024 * 1024)
export const MAX_CONCURRENT_DOWNLOADS_PER_USER = 2

// Statuses in which a client may see/download design deliverables.
export const CLIENT_OUTPUT_VISIBLE_STATUSES = ['submitted_to_client', 'approved'] as const

// Short TTL, refreshed after every file: a crashed/restarted process frees the user within minutes.
const SLOT_TTL_SECONDS = 15 * 60

const slotKey = (userId: string) => `bulk-download:active:${userId}`

/** Take a concurrency slot. Fails open when Redis is unavailable. */
export async function acquireDownloadSlot(userId: string): Promise<boolean> {
  if (connection.status !== 'ready') return true
  try {
    const n = await connection.incr(slotKey(userId))
    await connection.expire(slotKey(userId), SLOT_TTL_SECONDS)
    if (n > MAX_CONCURRENT_DOWNLOADS_PER_USER) {
      await connection.decr(slotKey(userId))
      return false
    }
    return true
  } catch (error) {
    console.error('[BulkDownload] slot acquire failed:', error)
    return true
  }
}

export async function releaseDownloadSlot(userId: string): Promise<void> {
  if (connection.status !== 'ready') return
  try {
    const n = await connection.decr(slotKey(userId))
    if (n <= 0) await connection.del(slotKey(userId))
  } catch (error) {
    console.error('[BulkDownload] slot release failed:', error)
  }
}

/** Keep the slot alive while a long download is still making progress. */
export async function refreshDownloadSlot(userId: string): Promise<void> {
  if (connection.status !== 'ready') return
  try {
    await connection.expire(slotKey(userId), SLOT_TTL_SECONDS)
  } catch {
    // best-effort
  }
}
