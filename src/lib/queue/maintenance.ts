import { sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { maintenanceQueue } from './client'

/**
 * Scheduled housekeeping as BullMQ job schedulers: the schedule lives in Redis, so it survives restarts and is
 * created idempotently on every worker boot (no "did the timer reset?" problem of setInterval), and only ONE
 * worker runs each tick even with several worker processes.
 */
export const MAINTENANCE_JOBS = {
  purgeAuthAudit: 'purge-auth-audit',     // daily 03:30 server time
  refreshRollups: 'refresh-rollups',      // every 5 minutes
  supportUploadReaper: 'support-upload-reaper', // hourly: support attachments never sent (support-system.md §13)
  supportSla: 'support-sla',                 // every minute: reply-time alerts
  supportAutoClose: 'support-auto-close',    // every 15 minutes: warn, then close conversations waiting on the lab
  supportEmailDigest: 'support-email-digest', // every minute: unread-message emails
} as const

export async function scheduleMaintenance(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler('purge-auth-audit-daily', { pattern: '30 3 * * *' }, { name: MAINTENANCE_JOBS.purgeAuthAudit })
  await maintenanceQueue.upsertJobScheduler('refresh-rollups-5m', { every: 5 * 60 * 1000 }, { name: MAINTENANCE_JOBS.refreshRollups })
  await maintenanceQueue.upsertJobScheduler('support-upload-reaper-hourly', { every: 60 * 60 * 1000 }, { name: MAINTENANCE_JOBS.supportUploadReaper })
  await maintenanceQueue.upsertJobScheduler('support-sla-1m', { every: 60 * 1000 }, { name: MAINTENANCE_JOBS.supportSla })
  await maintenanceQueue.upsertJobScheduler('support-auto-close-15m', { every: 15 * 60 * 1000 }, { name: MAINTENANCE_JOBS.supportAutoClose })
  await maintenanceQueue.upsertJobScheduler('support-email-digest-1m', { every: 60 * 1000 }, { name: MAINTENANCE_JOBS.supportEmailDigest })
}

export async function processMaintenance(name: string): Promise<unknown> {
  switch (name) {
    case MAINTENANCE_JOBS.purgeAuthAudit: {
      // Security trail is append-only; this SQL function is the only sanctioned delete (default: 400 days).
      const rows = await db.execute(sql`select purge_auth_audit_log() as removed`)
      const removed = Number((rows as unknown as Array<{ removed: string | number }>)[0]?.removed ?? 0)
      console.log(`[Maintenance] auth_audit_log purge removed ${removed} row(s)`)
      return { removed }
    }
    case MAINTENANCE_JOBS.refreshRollups: {
      // CONCURRENTLY: readers are never blocked (needs the unique indexes created in migration 1500).
      await db.execute(sql`refresh materialized view concurrently mv_cases_created_daily`)
      await db.execute(sql`refresh materialized view concurrently mv_cases_completed_daily`)
      return { refreshed: 2 }
    }
    case MAINTENANCE_JOBS.supportUploadReaper: {
      const { reapUnsentUploads } = await import('@/src/lib/support/attachments')
      const result = await reapUnsentUploads()
      if (result.removed > 0) console.log(`[Maintenance] removed ${result.removed} unsent support upload(s)`)
      return result
    }
    case MAINTENANCE_JOBS.supportSla: {
      const { runSlaSweep } = await import('@/src/lib/support/service')
      return runSlaSweep()
    }
    case MAINTENANCE_JOBS.supportAutoClose: {
      const { runAutoCloseSweep } = await import('@/src/lib/support/service')
      const result = await runAutoCloseSweep()
      if (result.warned + result.closed > 0) console.log(`[Maintenance] support auto-close: ${result.warned} warned, ${result.closed} closed`)
      return result
    }
    case MAINTENANCE_JOBS.supportEmailDigest: {
      const { sendEmailDigests } = await import('@/src/lib/support/digest')
      return sendEmailDigests()
    }
    default:
      throw new Error(`Unknown maintenance job: ${name}`)
  }
}
