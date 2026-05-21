import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { supportCallbackRequests } from '@/src/db/schema/support-callback-request'
import { createClient } from '@/src/lib/supabase/server'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error'
}

async function requireInternal() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (!['admin', 'qc', 'account_manager'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { profile }
}

export async function GET() {
  try {
    const auth = await requireInternal()
    if ('error' in auth) return auth.error

    const rows = await db
      .select({
        id: supportCallbackRequests.id,
        clientId: supportCallbackRequests.clientId,
        clientName: supportCallbackRequests.clientName,
        labName: supportCallbackRequests.labName,
        phone: supportCallbackRequests.phone,
        email: supportCallbackRequests.email,
        requestedAt: supportCallbackRequests.requestedAt,
      })
      .from(supportCallbackRequests)
      .orderBy(desc(supportCallbackRequests.requestedAt))

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[admin/support/callback-requests GET]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
