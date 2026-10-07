import { sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { opsDashboardSection } from '@/src/lib/ops-dashboard'

// Status counts across ALL cases (the old page counted only the newest 100 it had downloaded).
export async function GET() {
  return opsDashboardSection('kpis', async () => {
    const [row] = await db.select({
      active: sql<number>`count(*) filter (where ${cases.status} in ('scan_received','scan_verified','allocated_to_designer','in_progress','internal_qc'))::int`,
      delivered: sql<number>`count(*) filter (where ${cases.status} in ('approved','delivered'))::int`,
      pending: sql<number>`count(*) filter (where ${cases.status} = 'submitted_to_client')::int`,
      hold: sql<number>`count(*) filter (where ${cases.status} in ('on_hold','scan_not_verified'))::int`,
      cancelled: sql<number>`count(*) filter (where ${cases.status} = 'cancelled')::int`,
    }).from(cases)
    return row
  })
}
