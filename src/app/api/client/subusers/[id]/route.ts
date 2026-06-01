import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/src/lib/supabase/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { SubUserRepository } from '@/src/lib/repositories/subuser-repository'
import { SubUserService } from '@/src/lib/services/subuser-service'

const repo = new SubUserRepository()
const service = new SubUserService(repo)

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error'
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: subUserId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (profile.role !== 'client') {
      return NextResponse.json({ error: 'Forbidden: Only clients can manage sub-users' }, { status: 403 })
    }

    await service.deleteSubUser(subUserId, profile.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/client/subusers/[id]]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
