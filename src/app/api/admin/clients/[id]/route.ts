import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, subUsers } from '@/src/db/schema/profile'
import { cases } from '@/src/db/schema/case'
import { invoices } from '@/src/db/schema/invoice'
import { supportTickets } from '@/src/db/schema/support-ticket'
import { supportCallbackRequests } from '@/src/db/schema/support-callback-request'
import { createClient } from '@/src/lib/supabase/server'
import { supabaseAdmin } from '@/src/lib/supabase/admin'
import { getCachedData, setCachedData, deleteCachedData } from '@/src/lib/redis-cache'
import { logActivity } from '@/src/lib/activity-log'

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

// PATCH /api/admin/clients/[id] — deactivate / reactivate a client
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

    if (!['active', 'inactive'].includes(body.status)) {
      return NextResponse.json({ error: "status must be 'active' or 'inactive'" }, { status: 400 })
    }

    const [updated] = await db
      .update(profiles)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(profiles.id, id))
      .returning()

    await invalidateClientCaches(id)

    await logActivity({
      actor: auth.profile,
      action: body.status === 'active' ? 'client.activated' : 'client.deactivated',
      details: { clientId: id, labName: client.labName, email: client.email },
    }).catch((err) => console.error('[client status logActivity]', err))

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[admin/clients/[id] PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/admin/clients/[id] — permanently remove a client.
// Blocked whenever the client has any history (cases, invoices, sub-users,
// support tickets/callbacks) — those relations don't cascade-delete, and
// removing a client with real history would either fail loudly or silently
// orphan billing/audit records. Deactivate is the safe default for that case.
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

    const [
      [caseRow],
      [invoiceRow],
      [subUserRow],
      [ticketRow],
      [callbackRow],
    ] = await Promise.all([
      db.select({ id: cases.id }).from(cases).where(eq(cases.clientId, id)).limit(1),
      db.select({ id: invoices.id }).from(invoices).where(eq(invoices.clientId, id)).limit(1),
      db.select({ id: subUsers.id }).from(subUsers).where(eq(subUsers.clientId, id)).limit(1),
      db.select({ id: supportTickets.id }).from(supportTickets).where(eq(supportTickets.clientId, id)).limit(1),
      db.select({ id: supportCallbackRequests.id }).from(supportCallbackRequests).where(eq(supportCallbackRequests.clientId, id)).limit(1),
    ])

    const blockers: string[] = []
    if (caseRow) blockers.push('cases')
    if (invoiceRow) blockers.push('invoices')
    if (subUserRow) blockers.push('sub-users')
    if (ticketRow) blockers.push('support tickets')
    if (callbackRow) blockers.push('support callback requests')

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete this client — they still have ${blockers.join(', ')}. Deactivate the client instead to block their access while keeping their history intact.`,
        },
        { status: 409 }
      )
    }

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id)
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    try {
      await db.delete(profiles).where(eq(profiles.id, id))
    } catch (dbError) {
      // Safety net for any relation we didn't explicitly check above (e.g.
      // activity log entries) — the auth user is already gone at this point,
      // so surface a clear message rather than a raw FK violation.
      console.error('[admin/clients/[id] DELETE] profile row delete failed', dbError)
      return NextResponse.json(
        { error: 'Client login was removed, but their profile still has other linked records and could not be fully deleted. Deactivate instead for a clean removal.' },
        { status: 409 }
      )
    }

    await invalidateClientCaches(id)

    await logActivity({
      actor: auth.profile,
      action: 'client.deleted',
      details: { clientId: id, labName: client.labName, email: client.email },
    }).catch((err) => console.error('[client.deleted logActivity]', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/clients/[id] DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
