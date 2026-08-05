import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { getClientEnabledServiceTypes, setClientEnabledServiceTypes } from '@/src/lib/price-list'
import type { ServiceType } from '@/src/lib/case-status-mapping'
import { logActivity } from '@/src/lib/activity-log'

const VALID_SERVICE_TYPES: ServiceType[] = ['design_only', 'design_milling', 'milling_only']

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile }
}

async function getClient(id: string) {
  const [client] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
  if (!client || client.role !== 'client') return null
  return client
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const client = await getClient(id)
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const enabledServiceTypes = await getClientEnabledServiceTypes(id)
    return NextResponse.json({ data: { enabledServiceTypes } })
  } catch (error) {
    console.error('[admin/clients/[id]/service-types GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const client = await getClient(id)
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({} as { enabledServiceTypes?: unknown }))
    const raw: unknown[] = Array.isArray(body.enabledServiceTypes) ? body.enabledServiceTypes : []
    const enabledServiceTypes = raw.filter((t): t is ServiceType => VALID_SERVICE_TYPES.includes(t as ServiceType))

    if (enabledServiceTypes.length === 0) {
      return NextResponse.json({ error: 'A client must have at least one enabled service type' }, { status: 400 })
    }

    await setClientEnabledServiceTypes(id, enabledServiceTypes)

    await logActivity({
      actor: auth.profile,
      action: 'client.service_types_updated',
      details: { clientId: id, enabledServiceTypes },
    }).catch((err) => console.error('[client.service_types_updated logActivity]', err))

    return NextResponse.json({ data: { enabledServiceTypes } })
  } catch (error) {
    console.error('[admin/clients/[id]/service-types PUT]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}