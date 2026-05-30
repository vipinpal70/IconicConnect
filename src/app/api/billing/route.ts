/**
 * src/app/api/billing/route.ts
 * Purpose: Returns all dynamic invoices overview by grouping completed cases by client and month.
 * Authors: Antigravity AI
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { eq, or } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'
import { mapCaseToPricingInput, calculateCasePrice } from '@/src/lib/pricing'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify admin role
    const [adminProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!adminProfile || adminProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all cases that are completed (approved or delivered)
    const completedCases = await db.select()
      .from(cases)
      .where(or(eq(cases.status, 'approved'), eq(cases.status, 'delivered')))
      .orderBy(cases.createdAt)

    // Fetch all clients to map their names
    const clients = await db.select().from(profiles).where(eq(profiles.role, 'client'))
    const clientMap = new Map(clients.map(c => [c.id, c.labName || c.fullName || 'Unknown Client']))

    // Group cases by clientId and month
    const groups: Record<string, { clientId: string, monthKey: string, cases: typeof completedCases }> = {}

    for (const c of completedCases) {
      if (!c.clientId) continue
      const date = new Date(c.createdAt)
      const monthKey = date.toLocaleString('en-US', { month: 'long', year: 'numeric' }) // e.g. "May 2026"
      const groupKey = `${c.clientId}_${monthKey}`

      if (!groups[groupKey]) {
        groups[groupKey] = {
          clientId: c.clientId,
          monthKey,
          cases: []
        }
      }
      groups[groupKey].cases.push(c)
    }

    // Build invoices array
    const invoices = Object.values(groups).map((group) => {
      const clientName = clientMap.get(group.clientId) || 'Unknown Client'
      const caseCount = group.cases.length
      
      // Calculate amount
      let amount = 0
      for (const c of group.cases) {
        const pricingInput = mapCaseToPricingInput(c.category || '', c.subTypeData)
        if (pricingInput) {
          amount += calculateCasePrice(pricingInput)
        }
      }

      // Format month key for short id e.g. "INV-2026-05"
      const date = new Date(group.cases[0].createdAt)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const id = `INV-${year}-${month}-${group.clientId.slice(0, 4)}`

      // Status logic: current month is Pending, previous months are Paid
      const now = new Date()
      const isCurrentMonth = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
      const status = isCurrentMonth ? 'Pending' : 'Paid'

      return {
        id,
        clientId: group.clientId,
        client: clientName,
        month: group.monthKey,
        caseCount,
        amount,
        status
      }
    })

    return NextResponse.json(invoices)
  } catch (err) {
    console.error('[api/billing GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
