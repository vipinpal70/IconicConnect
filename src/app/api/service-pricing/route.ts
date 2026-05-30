/**
 * src/app/api/service-pricing/route.ts
 * Purpose: Returns all service pricing configurations from public tables.
 * Authors: Antigravity AI
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'

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

    // Fetch from all 5 pricing tables using raw SQL executions
    const crownBridgeRes = await db.execute(sql`SELECT * FROM pricing_crown_bridge ORDER BY sub_category`)
    const implantsRes = await db.execute(sql`SELECT * FROM pricing_implants ORDER BY sub_category, type`)
    const appliancesRes = await db.execute(sql`SELECT * FROM pricing_appliances ORDER BY appliance_type, occlusion_type, arch`)
    const denturesRes = await db.execute(sql`SELECT * FROM pricing_dentures ORDER BY sub_category, arch`)
    const cosmeticsRes = await db.execute(sql`SELECT * FROM pricing_cosmetics ORDER BY sub_category, arch`)

    return NextResponse.json({
      crownBridge: crownBridgeRes,
      implants: implantsRes,
      appliances: appliancesRes,
      dentures: denturesRes,
      cosmetics: cosmeticsRes
    })
  } catch (err) {
    console.error('[api/service-pricing GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
