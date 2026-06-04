import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/src/lib/supabase/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'
import { SubUserRepository } from '@/src/lib/repositories/subuser-repository'
import { SubUserService } from '@/src/lib/services/subuser-service'
import { logActivity } from '@/src/lib/activity-log'

const repo = new SubUserRepository()
const service = new SubUserService(repo)

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error'
}

// Resolve the owning client ID — for a subuser this is their createdBy (parent)
async function resolveClientId(userId: string): Promise<{ clientId: string; profile: typeof profiles.$inferSelect } | null> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1)
  if (!profile) return null

  if (profile.role === 'client') return { clientId: profile.id, profile }

  if (profile.role === 'subuser' && profile.createdBy) {
    const [parent] = await db.select().from(profiles).where(eq(profiles.id, profile.createdBy)).limit(1)
    if (parent && parent.role === 'client') return { clientId: parent.id, profile }
  }

  return null
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const resolved = await resolveClientId(user.id)
    if (!resolved) {
      return NextResponse.json({ error: 'Forbidden: Only clients and their sub-users can manage sub-users' }, { status: 403 })
    }

    const subusers = await service.getSubUsers(resolved.clientId)

    const formatted = subusers.map((u) => ({
      id: u.id,
      name: u.fullName || '',
      username: u.email.split('@')[0],
      email: u.email,
      role: u.title || 'Coordinator',
      password: u.password || '••••••••',
    }))

    return NextResponse.json({ data: formatted })
  } catch (error) {
    console.error('[GET /api/client/subusers]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const resolved = await resolveClientId(user.id)
    if (!resolved) {
      return NextResponse.json({ error: 'Forbidden: Only clients and their sub-users can manage sub-users' }, { status: 403 })
    }

    const body = await req.json()
    const { name, username, email, role, password } = body

    if (!name || !email || !role) {
      return NextResponse.json({ error: 'Name, email, and role are required' }, { status: 400 })
    }

    const newSubUser = await service.createSubUser(resolved.clientId, {
      name,
      username: username || email.split('@')[0],
      email,
      role,
      password,
    })

    const formatted = {
      id: newSubUser.id,
      name: newSubUser.fullName || '',
      username: newSubUser.email.split('@')[0],
      email: newSubUser.email,
      role: newSubUser.title || 'Coordinator',
      password: newSubUser.password || '••••••••',
    }

    await logActivity({
      actor: resolved.profile,
      action: 'subuser.created',
      details: { subuserId: newSubUser.id, email: newSubUser.email, fullName: newSubUser.fullName, role },
    }).catch((err) => console.error('[subuser.created logActivity]', err))

    return NextResponse.json({ data: formatted }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/client/subusers]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
