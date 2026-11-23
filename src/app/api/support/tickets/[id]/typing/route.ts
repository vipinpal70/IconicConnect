import { NextResponse } from 'next/server'
import { SupportError, enforceLimit, errorResponse, notFound, parseBody, parseId, requireSupportActor } from '@/src/lib/support/http'
import { isAgent } from '@/src/lib/support/policy'
import { isTicketVisible, personName } from '@/src/lib/support/queries'
import { publishToAgents, publishToBoth } from '@/src/lib/support/realtime'
import { typingSchema } from '@/src/lib/support/validation'
import { db } from '@/src/db'
import { supTickets } from '@/src/db/schema/support'
import { eq } from 'drizzle-orm'

/**
 * POST: "I'm typing" (ephemeral: published live, never stored). Someone typing an internal note is
 * only shown to staff.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor, profile } = await requireSupportActor()
    const ticketId = parseId((await params).id)
    const { visibility } = await parseBody(req, typingSchema)
    if (visibility === 'note' && !isAgent(actor)) throw new SupportError(403, 'forbidden', 'Internal notes are for the support team only')
    if (!(await isTicketVisible(actor, ticketId))) throw notFound()
    await enforceLimit(actor.id, 'typing')

    const event = {
      type: 'typing' as const,
      ticketId,
      userId: actor.id,
      name: personName(profile),
      side: isAgent(actor) ? ('agent' as const) : ('customer' as const),
    }
    if (visibility === 'note') {
      await publishToAgents(event)
    } else {
      const [ticket] = await db.select({ clientId: supTickets.clientId }).from(supTickets).where(eq(supTickets.id, ticketId)).limit(1)
      await publishToBoth(ticket.clientId, event)
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
