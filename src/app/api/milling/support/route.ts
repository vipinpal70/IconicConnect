import { NextRequest, NextResponse } from 'next/server'
import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { supportTickets } from '@/src/db/schema/support-ticket'
import { millingCenters } from '@/src/db/schema/milling'
import { requireMillingUser } from '@/src/lib/milling/portal-guard'
import { SUPPORT_TICKET_TYPES } from '@/src/lib/support-tickets'
import { notifySupportTicketCreated } from '@/src/lib/notifications/notification-dispatcher'
import { logActivity } from '@/src/lib/activity-log'

// Support tickets are scoped to the whole centre (any user at the centre can
// see tickets raised by their teammates), not just the requester.
async function centerProfileIds(millingCenterId: string) {
  const rows = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.millingCenterId, millingCenterId))
  return rows.map((r) => r.id)
}

export async function GET() {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const ids = await centerProfileIds(auth.millingCenterId)
    if (!ids.length) return NextResponse.json({ data: [] })

    const tickets = await db
      .select()
      .from(supportTickets)
      .where(inArray(supportTickets.clientId, ids))
      .orderBy(desc(supportTickets.updatedAt))

    return NextResponse.json({ data: tickets })
  } catch (error) {
    console.error('[milling/support GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMillingUser()
  if ('error' in auth) return auth.error

  try {
    const body = await req.json()
    const { subject, message, category } = body

    if (!subject || !message) {
      return NextResponse.json({ error: 'subject and message are required' }, { status: 400 })
    }
    const resolvedCategory = SUPPORT_TICKET_TYPES.includes(category) ? category : 'other'

    const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, auth.millingCenterId)).limit(1)

    const ticketNumber = `ST-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

    const [ticket] = await db
      .insert(supportTickets)
      .values({
        ticketNumber,
        clientId: auth.profile.id,
        subject,
        message,
        category: resolvedCategory,
        createdBy: auth.profile.id,
      })
      .returning()

    await notifySupportTicketCreated({
      actorUserId: auth.profile.id,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      clientName: `${center?.name ?? 'Milling centre'} — ${auth.profile.fullName || auth.profile.email}`,
    }).catch((err) => console.error('[notifySupportTicketCreated]', err))

    await logActivity({
      actor: auth.profile,
      action: 'support_ticket.created',
      details: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, subject, category: resolvedCategory },
    }).catch((err) => console.error('[support_ticket.created logActivity]', err))

    return NextResponse.json({ data: ticket }, { status: 201 })
  } catch (error) {
    console.error('[milling/support POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
