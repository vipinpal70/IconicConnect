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
} as const

export async function scheduleMaintenance(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler('purge-auth-audit-daily', { pattern: '30 3 * * *' }, { name: MAINTENANCE_JOBS.purgeAuthAudit })
  await maintenanceQueue.upsertJobScheduler('refresh-rollups-5m', { every: 5 * 60 * 1000 }, { name: MAINTENANCE_JOBS.refreshRollups })
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
    default:
      throw new Error(`Unknown maintenance job: ${name}`)
  }
}
