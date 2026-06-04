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

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    if (profile.role !== 'client') {
      return NextResponse.json({ error: 'Forbidden: Only clients can manage sub-users' }, { status: 403 })
    }

    const subusers = await service.getSubUsers(profile.id)

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

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    if (profile.role !== 'client') {
      return NextResponse.json({ error: 'Forbidden: Only clients can manage sub-users' }, { status: 403 })
    }

    const body = await req.json()
    const { name, username, email, role, password } = body

    if (!name || !email || !role) {
      return NextResponse.json({ error: 'Name, email, and role are required' }, { status: 400 })
    }

    const newSubUser = await service.createSubUser(profile.id, {
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
      actor: profile,
      action: 'subuser.created',
      details: { subuserId: newSubUser.id, email: newSubUser.email, fullName: newSubUser.fullName, role },
    }).catch((err) => console.error('[subuser.created logActivity]', err))

    return NextResponse.json({ data: formatted }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/client/subusers]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
