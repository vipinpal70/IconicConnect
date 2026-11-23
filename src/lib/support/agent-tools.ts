import { and, asc, count, desc, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles, users } from '@/src/db/schema/profile'
import { supCannedReplies, supTickets } from '@/src/db/schema/support'
import { getStatusLabel, type CaseStatus } from '@/src/lib/case-status-mapping'
import { formatTicketNumber } from './constants'
import { SupportError, notFound } from './http'
import { isAgent, type SupportActor } from './policy'
import { personName } from './queries'
import type { CannedReply, CustomerContext } from './types'
import type { CannedReplyInput } from './validation'

/**
 * Agent tools (support-system.md §8): canned replies and the customer panel. Agents only.
 *
 * Canned replies: shared ones (owner NULL) are visible to every agent and managed by admins; personal
 * ones belong to one agent. A shortcut is unique within the shared set and within each agent's set.
 */

function requireAgent(actor: SupportActor) {
  if (!isAgent(actor)) throw new SupportError(403, 'forbidden', 'Only the support team can do this')
}

const toView = (row: typeof supCannedReplies.$inferSelect, actor: SupportActor): CannedReply => ({
  id: row.id,
  title: row.title,
  body: row.body,
  shortcut: row.shortcut,
  shared: row.ownerId === null,
  editable: row.ownerId === actor.id || (row.ownerId === null && actor.role === 'admin'),
})

/** Postgres 23505. Drizzle wraps driver errors ("Failed query: …"), so look through `cause` too. */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === 'object' && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: string }).code === '23505') return true
  }
  return false
}

export async function listCannedReplies(actor: SupportActor): Promise<CannedReply[]> {
  requireAgent(actor)
  const rows = await db
    .select()
    .from(supCannedReplies)
    .where(or(isNull(supCannedReplies.ownerId), eq(supCannedReplies.ownerId, actor.id)))
    .orderBy(asc(supCannedReplies.title))
  return rows.map((r) => toView(r, actor))
}

export async function createCannedReply(actor: SupportActor, input: CannedReplyInput): Promise<CannedReply> {
  requireAgent(actor)
  if (input.shared && actor.role !== 'admin') throw new SupportError(403, 'forbidden', 'Only admins can create shared replies')
  try {
    const [row] = await db
      .insert(supCannedReplies)
      .values({
        title: input.title,
        body: input.body,
        shortcut: input.shortcut ?? null,
        ownerId: input.shared ? null : actor.id,
        createdBy: actor.id,
      })
      .returning()
    return toView(row, actor)
  } catch (error) {
    if (isUniqueViolation(error)) throw new SupportError(409, 'shortcut_taken', `The shortcut /${input.shortcut} is already in use`)
    throw error
  }
}

async function editableReply(actor: SupportActor, id: string) {
  requireAgent(actor)
  const [row] = await db.select().from(supCannedReplies).where(eq(supCannedReplies.id, id)).limit(1)
  // Someone else's personal reply is invisible: same answer as "doesn't exist"
  if (!row || (row.ownerId !== null && row.ownerId !== actor.id)) throw notFound()
  if (!toView(row, actor).editable) throw new SupportError(403, 'forbidden', 'Only admins can change shared replies')
  return row
}

export async function updateCannedReply(actor: SupportActor, id: string, input: Partial<CannedReplyInput>): Promise<CannedReply> {
  await editableReply(actor, id)
  const patch: Partial<typeof supCannedReplies.$inferInsert> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.body !== undefined) patch.body = input.body
  if (input.shortcut !== undefined) patch.shortcut = input.shortcut
  try {
    const [row] = await db.update(supCannedReplies).set(patch).where(eq(supCannedReplies.id, id)).returning()
    return toView(row, actor)
  } catch (error) {
    if (isUniqueViolation(error)) throw new SupportError(409, 'shortcut_taken', `The shortcut /${input.shortcut} is already in use`)
    throw error
  }
}

export async function deleteCannedReply(actor: SupportActor, id: string) {
  await editableReply(actor, id)
  await db.delete(supCannedReplies).where(eq(supCannedReplies.id, id))
}

// ── Customer panel ────────────────────────────────────────────────────────────────────────────────

const CLOSED_CASE_STATUSES = ['delivered', 'cancelled', 'client_reject', 'approved'] as const

export async function customerContext(actor: SupportActor, clientId: string, excludeTicketId?: string): Promise<CustomerContext> {
  requireAgent(actor)
  const [lab] = await db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      labName: profiles.labName,
      phone: profiles.phone,
      plan: profiles.plan,
      status: profiles.status,
      createdAt: profiles.createdAt,
      email: users.email,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.id))
    .where(and(eq(profiles.id, clientId), eq(profiles.role, 'client')))
    .limit(1)
  if (!lab) throw notFound()

  const otherTickets = excludeTicketId ? ne(supTickets.id, excludeTicketId) : undefined
  const [members, caseCounts, recentCases, ticketCounts, recentTickets, csat] = await Promise.all([
    db.select({ n: count() }).from(profiles).where(eq(profiles.clientId, clientId)),
    db
      .select({
        total: count(),
        open: sql<number>`count(*) filter (where ${cases.status}::text not in (${sql.join(CLOSED_CASE_STATUSES.map((s) => sql`${s}`), sql`, `)}))`.mapWith(Number),
      })
      .from(cases)
      .where(eq(cases.clientId, clientId)),
    db
      .select({ id: cases.id, caseNumber: cases.caseNumber, status: cases.status, createdAt: cases.createdAt })
      .from(cases)
      .where(eq(cases.clientId, clientId))
      .orderBy(desc(cases.createdAt))
      .limit(5),
    db
      .select({ total: count(), open: sql<number>`count(*) filter (where ${supTickets.status} <> 'closed')`.mapWith(Number) })
      .from(supTickets)
      .where(and(eq(supTickets.clientId, clientId), otherTickets)),
    db
      .select({ id: supTickets.id, number: supTickets.number, subject: supTickets.subject, status: supTickets.status, lastMessageAt: supTickets.lastMessageAt })
      .from(supTickets)
      .where(and(eq(supTickets.clientId, clientId), otherTickets))
      .orderBy(desc(supTickets.lastMessageAt))
      .limit(5),
    db
      .select({ average: sql<number | null>`avg(${supTickets.csatScore})`.mapWith((v) => (v === null ? null : Number(v))), ratings: count(supTickets.csatScore) })
      .from(supTickets)
      .where(eq(supTickets.clientId, clientId)),
  ])

  return {
    lab: {
      id: lab.id,
      name: personName({ fullName: lab.fullName, labName: lab.labName, role: 'client' }),
      ownerName: lab.fullName,
      email: lab.email,
      phone: lab.phone,
      plan: lab.plan,
      status: lab.status,
      memberSince: lab.createdAt.toISOString(),
      members: Number(members[0]?.n ?? 0),
    },
    cases: {
      total: Number(caseCounts[0]?.total ?? 0),
      open: caseCounts[0]?.open ?? 0,
      recent: recentCases.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        status: c.status,
        statusLabel: getStatusLabel(c.status as CaseStatus, 'admin'),
        createdAt: c.createdAt.toISOString(),
      })),
    },
    conversations: {
      total: Number(ticketCounts[0]?.total ?? 0),
      open: ticketCounts[0]?.open ?? 0,
      recent: recentTickets.map((t) => ({
        id: t.id,
        number: formatTicketNumber(t.number),
        subject: t.subject,
        status: t.status,
        lastMessageAt: t.lastMessageAt.toISOString(),
      })),
    },
    satisfaction: {
      average: csat[0]?.average === null || csat[0]?.average === undefined ? null : Math.round(csat[0].average * 10) / 10,
      ratings: Number(csat[0]?.ratings ?? 0),
    },
  }
}
