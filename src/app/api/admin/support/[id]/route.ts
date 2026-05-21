import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { supportTickets } from '@/src/db/schema/support-ticket'
import { createClient } from '@/src/lib/supabase/server'
import { SUPPORT_TICKET_STATUSES } from '@/src/lib/support-tickets'

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

  if (!['admin', 'qc', 'account_manager'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user, profile }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth.error

    const { id } = await params
    const body = await req.json()
    const status = typeof body.status === 'string' ? body.status : undefined
    const adminNotes = typeof body.adminNotes === 'string' ? body.adminNotes.trim() : undefined

    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1)

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    const updateData: Partial<typeof supportTickets.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (status !== undefined) {
      if (!SUPPORT_TICKET_STATUSES.includes(status as (typeof SUPPORT_TICKET_STATUSES)[number])) {
        return NextResponse.json({ error: 'Invalid ticket status' }, { status: 400 })
      }
      updateData.status = status as (typeof SUPPORT_TICKET_STATUSES)[number]
      updateData.resolvedAt = status === 'resolved' || status === 'closed' ? new Date() : null
    }

    if (adminNotes !== undefined) {
      updateData.adminNotes = adminNotes || null
    }

    const [updated] = await db.update(supportTickets).set(updateData).where(eq(supportTickets.id, id)).returning()

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[admin/support/[id] PATCH]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 })
  }
}
