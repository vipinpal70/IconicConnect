import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { supportTickets } from '@/src/db/schema/support-ticket'
import { createClient } from '@/src/lib/supabase/server'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error'
}

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

  if (!['admin', 'qc', 'account_manager', 'consultant', 'designer'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user, profile }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const rows = await db
      .select({
        id: supportTickets.id,
        ticketNumber: supportTickets.ticketNumber,
        clientId: supportTickets.clientId,
        subject: supportTickets.subject,
        message: supportTickets.message,
        category: supportTickets.category,
        priority: supportTickets.priority,
        status: supportTickets.status,
        adminNotes: supportTickets.adminNotes,
        resolvedAt: supportTickets.resolvedAt,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
        clientName: profiles.fullName,
        labName: profiles.labName,
        clientEmail: profiles.email,
      })
      .from(supportTickets)
      .leftJoin(profiles, eq(supportTickets.clientId, profiles.id))
      .orderBy(desc(supportTickets.updatedAt))

    const filtered = status && status !== 'all'
      ? rows.filter((ticket) => ticket.status === status)
      : rows

    return NextResponse.json({ data: filtered })
  } catch (error) {
    console.error('[admin/support GET]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
