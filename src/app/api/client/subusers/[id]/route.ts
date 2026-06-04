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

async function resolveClientId(userId: string): Promise<string | null> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1)
  if (!profile) return null
  if (profile.role === 'client') return profile.id
  if (profile.role === 'subuser' && profile.createdBy) {
    const [parent] = await db.select().from(profiles).where(eq(profiles.id, profile.createdBy)).limit(1)
    if (parent && parent.role === 'client') return parent.id
  }
  return null
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: subUserId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const clientId = await resolveClientId(user.id)
    if (!clientId) {
      return NextResponse.json({ error: 'Forbidden: Only clients and their sub-users can manage sub-users' }, { status: 403 })
    }

    // Prevent a sub-user from deleting themselves
    if (subUserId === user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    await service.deleteSubUser(subUserId, clientId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/client/subusers/[id]]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
