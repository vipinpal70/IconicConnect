import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id)).limit(1)

    if (!caseRecord) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    if (profile.role === 'subuser' && caseRecord.subuserId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: You can only view your own cases' }, { status: 403 })
    }

    if (profile.role === 'client' && caseRecord.clientId !== profile.id) {
      return NextResponse.json({ error: 'Forbidden: You can only view cases from your lab' }, { status: 403 })
    }

    return NextResponse.json({ data: caseRecord.timeline ?? [] })
  } catch (error) {
    console.error('Get case activity error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
