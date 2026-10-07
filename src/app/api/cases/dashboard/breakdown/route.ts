import { sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { opsDashboardSection } from '@/src/lib/ops-dashboard'

// Share of cases per category, percent, largest first.
export async function GET() {
  return opsDashboardSection('breakdown', async () => {
    const rows = await db.select({ category: cases.category, n: sql<number>`count(*)::int` })
      .from(cases).groupBy(cases.category)
    const total = rows.reduce((sum, r) => sum + r.n, 0)
    return rows
      .map((r) => ({ name: r.category || 'Other', value: total > 0 ? Math.round((r.n / total) * 100) : 0 }))
      .sort((a, b) => b.value - a.value)
  })
}
