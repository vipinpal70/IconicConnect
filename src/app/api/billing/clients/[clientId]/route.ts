/**
 * src/app/api/billing/clients/[clientId]/route.ts
 * Purpose: Returns client details, case list with calculated prices, and total price.
 * Authors: Antigravity AI
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { eq, and, gte, lte } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'
import { mapCaseToPricingInput, calculateCasePrice } from '@/src/lib/pricing'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params
    const { searchParams } = new URL(req.url)
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')

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

    // Fetch the client profile (unless clientId is 'all')
    let clientProfile = null
    if (clientId !== 'all') {
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1)
      if (!profile) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
      clientProfile = profile
    }

    // Build query conditions
    const conditions = []
    if (clientId !== 'all') {
      conditions.push(eq(cases.clientId, clientId))
    }

    if (startDateParam) {
      const start = new Date(startDateParam)
      start.setHours(0, 0, 0, 0)
      conditions.push(gte(cases.createdAt, start))
    }

    if (endDateParam) {
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      conditions.push(lte(cases.createdAt, end))
    }

    // Query cases
    const clientCases = await db.select()
      .from(cases)
      .where(and(...conditions))
      .orderBy(cases.createdAt)

    let totalPrice = 0
    const detailedCases = clientCases.map(c => {
      const pricingInput = mapCaseToPricingInput(c.category || '', c.subTypeData)
      const price = pricingInput ? calculateCasePrice(pricingInput) : 0
      totalPrice += price

      return {
        id: c.id,
        caseNumber: c.caseNumber,
        category: c.category,
        subTypeData: c.subTypeData,
        status: c.status,
        createdAt: c.createdAt,
        dueDate: c.dueDate,
        price
      }
    })

    return NextResponse.json({
      client: clientProfile ? {
        id: clientProfile.id,
        fullName: clientProfile.fullName,
        labName: clientProfile.labName,
        email: clientProfile.email,
        phone: clientProfile.phone,
        city: clientProfile.city,
        state: clientProfile.state,
        postalCode: clientProfile.postalCode,
        country: clientProfile.country,
      } : {
        id: 'all',
        fullName: 'All Clients',
        labName: 'All Clients',
        email: '',
        phone: '',
        city: '',
        state: '',
        postalCode: '',
        country: '',
      },
      cases: detailedCases,
      totalPrice
    })
  } catch (err) {
    console.error('[api/billing/clients/[clientId] GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
