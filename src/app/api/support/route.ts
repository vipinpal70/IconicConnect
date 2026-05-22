import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, subUsers } from '@/src/db/schema/profile'
import { supportTickets } from '@/src/db/schema/support-ticket'
import { createClient } from '@/src/lib/supabase/server'
import { notifySupportTicketCreated } from '@/src/lib/notifications/notification-dispatcher'
import { SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_TYPES, isClientSupportStatus } from '@/src/lib/support-tickets'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error'
}

async function getAuthenticatedPortalUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  return { user, profile, supabase }
}

async function resolveClientId(profileId: string, role: string) {
  if (role === 'client') {
    return profileId
  }

  if (role === 'subuser') {
    const [subUserRecord] = await db.select().from(subUsers).where(eq(subUsers.profileId, profileId)).limit(1)
    return subUserRecord?.clientId || profileId
  }

  return null
}

export async function GET() {
  try {
    const auth = await getAuthenticatedPortalUser()
    if ('error' in auth) return auth.error

    const { profile } = auth
    if (profile.userType !== 'lab_portal') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const clientId = await resolveClientId(profile.id, profile.role)

    if (!clientId) {
      return NextResponse.json({ error: 'Unauthorized role' }, { status: 403 })
    }

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
      })
      .from(supportTickets)
      .leftJoin(profiles, eq(supportTickets.clientId, profiles.id))
      .where(eq(supportTickets.clientId, clientId))
      .orderBy(desc(supportTickets.updatedAt))

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[support GET]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedPortalUser()
    if ('error' in auth) return auth.error

    const { profile } = auth
    if (profile.userType !== 'lab_portal') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const clientId = await resolveClientId(profile.id, profile.role)

    if (!clientId) {
      return NextResponse.json({ error: 'Unauthorized role' }, { status: 403 })
    }

    const body = await req.json()
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const category = typeof body.category === 'string' ? body.category : ''
    const priority = typeof body.priority === 'string' ? body.priority : 'medium'

    if (!subject || !message || !category) {
      return NextResponse.json({ error: 'Subject, message, and category are required' }, { status: 400 })
    }

    if (!SUPPORT_TICKET_TYPES.includes(category as (typeof SUPPORT_TICKET_TYPES)[number])) {
      return NextResponse.json({ error: 'Invalid ticket category' }, { status: 400 })
    }

    if (!SUPPORT_TICKET_PRIORITIES.includes(priority as (typeof SUPPORT_TICKET_PRIORITIES)[number])) {
      return NextResponse.json({ error: 'Invalid ticket priority' }, { status: 400 })
    }

    const ticketNumber = `ST-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

    const [ticket] = await db.insert(supportTickets).values({
      ticketNumber,
      clientId,
      subject,
      message,
      category: category as (typeof SUPPORT_TICKET_TYPES)[number],
      priority: priority as (typeof SUPPORT_TICKET_PRIORITIES)[number],
      status: 'open',
    }).returning()

    await notifySupportTicketCreated({
      actorUserId: profile.id,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      clientName: profile.labName || profile.fullName || profile.email || 'Client',
    })

    return NextResponse.json({ data: ticket }, { status: 201 })
  } catch (error) {
    console.error('[support POST]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await getAuthenticatedPortalUser()
    if ('error' in auth) return auth.error

    const { profile } = auth
    const clientId = await resolveClientId(profile.id, profile.role)

    if (!clientId) {
      return NextResponse.json({ error: 'Unauthorized role' }, { status: 403 })
    }

    const body = await req.json()
    const ticketId = typeof body.id === 'string' ? body.id : ''
    const status = typeof body.status === 'string' ? body.status : ''

    if (!ticketId || !status) {
      return NextResponse.json({ error: 'Ticket id and status are required' }, { status: 400 })
    }

    if (!isClientSupportStatus(status)) {
      return NextResponse.json({ error: 'Clients can only set tickets to open, resolved, or closed' }, { status: 400 })
    }

    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1)

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    if (ticket.clientId !== clientId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [updated] = await db.update(supportTickets).set({
      status,
      updatedAt: new Date(),
      resolvedAt: status === 'resolved' || status === 'closed' ? new Date() : null,
    }).where(and(eq(supportTickets.id, ticketId), eq(supportTickets.clientId, clientId))).returning()

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[support PATCH]', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
