import { desc } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { opsDashboardSection } from '@/src/lib/ops-dashboard'

// The 5 most recently updated cases — only the columns the card shows.
export async function GET() {
  return opsDashboardSection('recent', async () => {
    const rows = await db.select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      category: cases.category,
      status: cases.status,
      subTypeData: cases.subTypeData,
    }).from(cases).orderBy(desc(cases.updatedAt)).limit(5)

    return rows.map((c) => {
      const d = c.subTypeData as Record<string, string | undefined> | null
      return {
        id: c.caseNumber || c.id.slice(0, 8),
        restoration: d?.caseType || d?.caseType1 || c.category || 'Case',
        status: c.status,
        caseType: c.category || 'General',
      }
    })
  })
}
