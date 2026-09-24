import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { getCachedData, setCachedData, deleteCachedData } from '@/src/lib/redis-cache'
import { logActivity } from '@/src/lib/activity-log'
import { deleteClientCompletely } from '@/src/lib/admin/delete-client'

const CLIENT_TTL = 3600 // 1 hour
const clientKey = (id: string) => `client:${id}`

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const key = clientKey(id)

    const cached = await getCachedData<typeof profiles.$inferSelect>(key)
    if (cached) {
      return NextResponse.json({ data: cached })
    }

    const [client] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)

    if (!client || client.role !== 'client') {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    await setCachedData(key, client, CLIENT_TTL)
    return NextResponse.json({ data: client })
  } catch (error) {
    console.error('[admin/clients/[id] GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function invalidateClientCaches(id: string) {
  await Promise.all([
    deleteCachedData(clientKey(id)),
    deleteCachedData('clients:list'),
  ])
}

// PATCH /api/admin/clients/[id] — deactivate / reactivate a client, and/or
// toggle "3D Model only" lab restriction (3d-model-implement-plan.md §3)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const [client] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    if (!client || client.role !== 'client') {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const body = await req.json()

    if (body.status === undefined && body.modelOnlyLab === undefined) {
      return NextResponse.json({ error: "Provide 'status' and/or 'modelOnlyLab'" }, { status: 400 })
    }

    const updates: { status?: 'active' | 'inactive'; modelOnlyLab?: boolean; updatedAt: Date } = {
      updatedAt: new Date(),
    }

    if (body.status !== undefined) {
      if (!['active', 'inactive'].includes(body.status)) {
        return NextResponse.json({ error: "status must be 'active' or 'inactive'" }, { status: 400 })
      }
      updates.status = body.status
    }

    if (body.modelOnlyLab !== undefined) {
      if (typeof body.modelOnlyLab !== 'boolean') {
        return NextResponse.json({ error: 'modelOnlyLab must be a boolean' }, { status: 400 })
      }
      updates.modelOnlyLab = body.modelOnlyLab
    }

    const [updated] = await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, id))
      .returning()

    await invalidateClientCaches(id)

    if (updates.status !== undefined) {
      await logActivity({
        actor: auth.profile,
        action: updates.status === 'active' ? 'client.activated' : 'client.deactivated',
        details: { clientId: id, labName: client.labName, email: client.email },
      }).catch((err) => console.error('[client status logActivity]', err))
    }

    if (updates.modelOnlyLab !== undefined) {
      await logActivity({
        actor: auth.profile,
        action: 'client.model_only_lab_updated',
        details: { clientId: id, labName: client.labName, email: client.email, modelOnlyLab: updates.modelOnlyLab },
      }).catch((err) => console.error('[client modelOnlyLab logActivity]', err))
    }

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[admin/clients/[id] PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/admin/clients/[id] — permanently remove a client: every
// sub-user, case, file record, invoice, support ticket/callback, and
// activity-log entry linked to them, plus their (and their sub-users')
// Supabase Auth login. Irreversible — the admin UI gates this behind a
// confirmation dialog; there is no history-preserving fallback here anymore.
// Use PATCH { status: 'inactive' } to block access while keeping history.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const [client] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    if (!client || client.role !== 'client') {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    let result
    try {
      result = await deleteClientCompletely(id)
    } catch (dbError) {
      console.error('[admin/clients/[id] DELETE] cascade delete failed', dbError)
      return NextResponse.json(
        { error: 'Failed to delete client — nothing was changed.' },
        { status: 500 }
      )
    }

    await invalidateClientCaches(id)

    await logActivity({
      actor: auth.profile,
      action: 'client.deleted',
      details: {
        clientId: id,
        labName: client.labName,
        email: client.email,
        casesDeleted: result.casesDeleted,
        subUsersDeleted: result.subUserProfileIds.length,
        authDeleteErrors: result.authDeleteErrors,
      },
    }).catch((err) => console.error('[client.deleted logActivity]', err))

    if (result.authDeleteErrors.length > 0) {
      return NextResponse.json({
        success: true,
        warning: `Client data was deleted, but ${result.authDeleteErrors.length} login(s) could not be removed from Supabase Auth. Check server logs and remove them manually if needed.`,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/clients/[id] DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
