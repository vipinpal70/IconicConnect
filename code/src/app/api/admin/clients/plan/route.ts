import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { createClient } from '@/src/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if the requester is an admin
    const [adminProfile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!adminProfile || adminProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { clientId, plan } = await req.json()
    if (!clientId || !plan) {
      return NextResponse.json({ error: 'Client ID and Plan are required' }, { status: 400 })
    }

    if (!['Trial', 'Onboarded'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan status' }, { status: 400 })
    }

    // Update client plan
    const updateData: any = { 
      plan: plan as 'Trial' | 'Onboarded', 
      updatedAt: new Date() 
    }

    if (plan === 'Onboarded') {
      updateData.onBoardedAt = new Date()
    }

    await db.update(profiles)
      .set(updateData)
      .where(eq(profiles.id, clientId))

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/clients/plan POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
