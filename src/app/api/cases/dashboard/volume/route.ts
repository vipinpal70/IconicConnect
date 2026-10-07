import { gte, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { opsDashboardSection } from '@/src/lib/ops-dashboard'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Cases created per month for the last 6 months.
export async function GET() {
  return opsDashboardSection('volume', async () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const rows = await db.select({
      y: sql<number>`extract(year from ${cases.createdAt})::int`,
      m: sql<number>`extract(month from ${cases.createdAt})::int`,
      n: sql<number>`count(*)::int`,
    }).from(cases).where(gte(cases.createdAt, start)).groupBy(sql`1, 2`)

    const counts = new Map(rows.map((r) => [`${r.y}-${r.m - 1}`, r.n]))
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      return { month: MONTH_NAMES[d.getMonth()], cases: counts.get(`${d.getFullYear()}-${d.getMonth()}`) ?? 0 }
    })
  })
}
