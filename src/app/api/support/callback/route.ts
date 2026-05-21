import { NextResponse } from 'next/server'
import { inArray, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { notifications } from '@/src/db/schema/notification'
import { profiles, subUsers } from '@/src/db/schema/profile'
import { supportCallbackRequests } from '@/src/db/schema/support-callback-request'
import { createClient } from '@/src/lib/supabase/server'

async function getClientContext() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (profile.role !== 'client' && profile.role !== 'subuser') {
    if (profile.userType !== 'lab_portal') {
      return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }
  }

  const clientId = profile.role === 'client'
    ? profile.id
    : await db.select().from(subUsers).where(eq(subUsers.profileId, profile.id)).limit(1).then((rows) => rows[0]?.clientId || profile.id)

  if (!clientId) {
    return { error: NextResponse.json({ error: 'Client account not found' }, { status: 404 }) }
  }

  const clientProfile = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1).then((rows) => rows[0] ?? null)

  return { profile, clientId, clientProfile }
}

export async function POST() {
  try {
    const auth = await getClientContext()
    if ('error' in auth) return auth.error

    const { clientId, clientProfile, profile } = auth
    const internalRecipients = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(inArray(profiles.role, ['admin', 'qc', 'account_manager']))

    if (internalRecipients.length === 0) {
      return NextResponse.json({ data: { notifiedCount: 0 } })
    }

    const clientLabel = clientProfile?.labName || clientProfile?.fullName || clientProfile?.email || 'Client'
    const requester = profile.fullName || profile.email || 'A client'
    const clientName = clientProfile?.fullName || requester
    const labName = clientProfile?.labName || clientLabel

    await db.insert(supportCallbackRequests).values({
      clientId,
      clientName,
      labName,
      phone: clientProfile?.phone || null,
      email: clientProfile?.email || requester,
    })

    await db.insert(notifications).values(
      internalRecipients.map((recipient) => ({
        userId: recipient.id,
        title: 'Callback requested',
        message: `${clientLabel} requested a callback. Requested by ${requester}.`,
        type: 'support',
      }))
    )

    return NextResponse.json({ data: { notifiedCount: internalRecipients.length } })
  } catch (error) {
    console.error('[support/callback POST]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 })
  }
}
