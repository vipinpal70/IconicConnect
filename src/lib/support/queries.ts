import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { supMessages, supReads, supTickets } from '@/src/db/schema/support'
import { AGENT_ROLES, CUSTOMER_ROLES, formatTicketNumber, type SupportSide } from './constants'
import { allowedActions, canViewTicket, isAgent, isCustomer, reopenDeadline, type SupportActor } from './policy'
import type { MessageView, MessagesResponse, PersonRef, SupportSummary, TicketDetail, TicketListResponse, TicketSummary } from './types'
import type { ListMessagesQuery, ListTicketsQuery } from './validation'
import { attachmentsForMessages } from './attachments'

/**
 * Read side of the support system. Every query is scoped by the caller: customers only ever see their
 * lab's conversations, and internal notes are filtered out here (not just hidden in the UI).
 */

const lab = alias(profiles, 'sup_lab')
const assignee = alias(profiles, 'sup_assignee')
const creator = alias(profiles, 'sup_creator')
const author = alias(profiles, 'sup_author')

const ROLE_NAMES: Record<string, string> = {
  admin: 'Support',
  qc: 'Support',
  account_manager: 'Account manager',
  client: 'Lab',
  subuser: 'Lab member',
}

type NameFields = { id: string | null; fullName: string | null; labName: string | null; role: string | null }

export function personName(p: Omit<NameFields, 'id'>): string {
  if (p.role === 'client') return p.labName || p.fullName || 'Lab'
  return p.fullName || ROLE_NAMES[p.role ?? ''] || 'Deleted user'
}

function personRef(p: NameFields): PersonRef | null {
  return p.id ? { id: p.id, name: personName(p) } : null
}

const sideOf = (role: string | null): SupportSide => ((CUSTOMER_ROLES as readonly string[]).includes(role ?? '') ? 'customer' : 'agent')
const viewerSide = (actor: SupportActor): SupportSide => (isAgent(actor) ? 'agent' : 'customer')
const iso = (d: Date | null) => (d ? d.toISOString() : null)
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

const ticketColumns = {
  id: supTickets.id,
  number: supTickets.number,
  legacyNumber: supTickets.legacyNumber,
  subject: supTickets.subject,
  category: supTickets.category,
  priority: supTickets.priority,
  status: supTickets.status,
  clientId: supTickets.clientId,
  assigneeId: supTickets.assigneeId,
  createdAt: supTickets.createdAt,
  lastMessageAt: supTickets.lastMessageAt,
  lastMessageSeq: supTickets.lastMessageSeq,
  lastPublicSender: supTickets.lastPublicSender,
  closedAt: supTickets.closedAt,
  labFullName: lab.fullName,
  labLabName: lab.labName,
  assigneeFullName: assignee.fullName,
  assigneeRole: assignee.role,
}

type TicketRow = {
  id: string
  number: number
  legacyNumber: string | null
  subject: string
  category: TicketSummary['category']
  priority: TicketSummary['priority']
  status: TicketSummary['status']
  clientId: string
  assigneeId: string | null
  createdAt: Date
  lastMessageAt: Date
  lastMessageSeq: number
  lastPublicSender: SupportSide | null
  closedAt: Date | null
  labFullName: string | null
  labLabName: string | null
  assigneeFullName: string | null
  assigneeRole: string | null
  readSeq: number
  preview: string | null
}

function toSummary(row: TicketRow, actor: SupportActor): TicketSummary {
  const side = viewerSide(actor)
  return {
    id: row.id,
    number: formatTicketNumber(row.number),
    legacyNumber: row.legacyNumber,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    lab: { id: row.clientId, name: personName({ fullName: row.labFullName, labName: row.labLabName, role: 'client' }) },
    assignee: personRef({ id: row.assigneeId, fullName: row.assigneeFullName, labName: null, role: row.assigneeRole }),
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastPublicSender: row.lastPublicSender,
    unread: row.lastMessageSeq > row.readSeq && row.lastPublicSender !== side,
    preview: row.preview ? row.preview.slice(0, 160) : null,
  }
}

/** Newest message the caller may see, for the list preview (uses the unique seq index). */
const previewSql = sql<string | null>`(select coalesce(nullif(m.body, ''), 'Attachment') from sup_messages m
  where m.seq = ${supTickets.lastMessageSeq} and m.deleted_at is null)`

function baseTicketQuery(actor: SupportActor) {
  return db
    .select({
      ...ticketColumns,
      readSeq: sql<number>`coalesce(${supReads.lastReadSeq}, 0)`.mapWith(Number),
      preview: previewSql,
    })
    .from(supTickets)
    .innerJoin(lab, eq(lab.id, supTickets.clientId))
    .leftJoin(assignee, eq(assignee.id, supTickets.assigneeId))
    .leftJoin(supReads, and(eq(supReads.ticketId, supTickets.id), eq(supReads.userId, actor.id)))
}

function scopeCondition(actor: SupportActor): SQL | undefined {
  if (isAgent(actor)) return undefined
  if (isCustomer(actor)) return eq(supTickets.clientId, actor.clientId!)
  return sql`false`
}

export async function listTickets(actor: SupportActor, query: ListTicketsQuery): Promise<TicketListResponse> {
  const conditions: (SQL | undefined)[] = [scopeCondition(actor)]
  const agent = isAgent(actor)
  const view = !agent && (query.view === 'mine' || query.view === 'unassigned') ? 'open' : query.view

  if (view === 'open') conditions.push(ne(supTickets.status, 'closed'))
  if (view === 'closed') conditions.push(eq(supTickets.status, 'closed'))
  if (view === 'unassigned') conditions.push(ne(supTickets.status, 'closed'), isNull(supTickets.assigneeId))
  if (view === 'mine') conditions.push(ne(supTickets.status, 'closed'), eq(supTickets.assigneeId, actor.id))
  if (query.status) conditions.push(eq(supTickets.status, query.status))
  if (query.priority) conditions.push(eq(supTickets.priority, query.priority))
  if (query.category) conditions.push(eq(supTickets.category, query.category))

  if (query.q) {
    const like = `%${escapeLike(query.q)}%`
    const numberMatch = /^(?:sup-?)?0*(\d{1,12})$/i.exec(query.q)
    const visibleKinds = agent ? sql`` : sql`and m.kind <> 'note'`
    conditions.push(
      or(
        ilike(supTickets.subject, like),
        eq(supTickets.legacyNumber, query.q),
        numberMatch ? eq(supTickets.number, Number(numberMatch[1])) : undefined,
        agent ? ilike(lab.labName, like) : undefined,
        sql`exists (select 1 from sup_messages m where m.ticket_id = ${supTickets.id} and m.deleted_at is null ${visibleKinds}
               and to_tsvector('simple', m.body) @@ plainto_tsquery('simple', ${query.q}))`,
      ),
    )
  }

  // Keyset paging on (last activity, id): stable and index-friendly, unlike OFFSET
  if (query.cursor) {
    conditions.push(
      sql`(${supTickets.lastMessageAt}, ${supTickets.id}) < (select c.last_message_at, c.id from sup_tickets c where c.id = ${query.cursor}::uuid)`,
    )
  }

  const rows = (await baseTicketQuery(actor)
    .where(and(...conditions))
    .orderBy(desc(supTickets.lastMessageAt), desc(supTickets.id))
    .limit(query.limit + 1)) as TicketRow[]

  const page = rows.slice(0, query.limit)
  return {
    tickets: page.map((row) => toSummary(row, actor)),
    nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
  }
}

/** Cheap visibility check (one PK lookup) for endpoints that don't need the full header. */
export async function isTicketVisible(actor: SupportActor, ticketId: string): Promise<boolean> {
  const [row] = await db.select({ clientId: supTickets.clientId }).from(supTickets).where(eq(supTickets.id, ticketId)).limit(1)
  return Boolean(row) && canViewTicket(actor, row)
}

/** Ticket header + what the caller may do. Returns null when the ticket doesn't exist or isn't visible. */
export async function getTicketDetail(actor: SupportActor, ticketId: string, now = new Date()): Promise<TicketDetail | null> {
  const side = viewerSide(actor)
  const otherRoles = side === 'agent' ? CUSTOMER_ROLES : AGENT_ROLES
  const [row] = (await baseTicketQuery(actor)
    .where(and(eq(supTickets.id, ticketId), scopeCondition(actor)))
    .limit(1)) as TicketRow[]
  if (!row) return null

  const [extra] = await db
    .select({
      createdById: supTickets.createdBy,
      creatorFullName: creator.fullName,
      creatorLabName: creator.labName,
      creatorRole: creator.role,
      closeReason: supTickets.closeReason,
      reopenedCount: supTickets.reopenedCount,
      otherSideReadSeq: sql<number>`coalesce((
        select max(r.last_read_seq) from sup_reads r join profiles p on p.id = r.user_id
        where r.ticket_id = ${supTickets.id} and p.user_role::text in (${sql.join(otherRoles.map((r) => sql`${r}`), sql`, `)})
      ), 0)`.mapWith(Number),
    })
    .from(supTickets)
    .leftJoin(creator, eq(creator.id, supTickets.createdBy))
    .where(eq(supTickets.id, ticketId))
    .limit(1)

  const access = { clientId: row.clientId, status: row.status, closedAt: row.closedAt, assigneeId: row.assigneeId }
  if (!canViewTicket(actor, access)) return null
  const deadline = reopenDeadline(access)

  return {
    ...toSummary(row, actor),
    createdBy: personRef({ id: extra.createdById, fullName: extra.creatorFullName, labName: extra.creatorLabName, role: extra.creatorRole }),
    closedAt: iso(row.closedAt),
    closeReason: extra.closeReason,
    reopenedCount: extra.reopenedCount,
    reopenUntil: side === 'customer' ? iso(deadline) : null,
    actions: allowedActions(actor, access, now),
    otherSideReadSeq: extra.otherSideReadSeq,
    viewerSide: side,
    viewerId: actor.id,
  }
}

export async function listMessages(actor: SupportActor, ticketId: string, query: ListMessagesQuery): Promise<MessagesResponse> {
  const conditions: SQL[] = [eq(supMessages.ticketId, ticketId)]
  if (!isAgent(actor)) conditions.push(ne(supMessages.kind, 'note'))

  const select = db
    .select({
      id: supMessages.id,
      seq: supMessages.seq,
      kind: supMessages.kind,
      body: supMessages.body,
      createdAt: supMessages.createdAt,
      editedAt: supMessages.editedAt,
      deletedAt: supMessages.deletedAt,
      authorId: supMessages.authorId,
      authorFullName: author.fullName,
      authorLabName: author.labName,
      authorRole: author.role,
    })
    .from(supMessages)
    .leftJoin(author, eq(author.id, supMessages.authorId))

  let rows: Awaited<typeof select>
  let hasMoreBefore = false
  if (query.after !== undefined) {
    rows = await select.where(and(...conditions, gt(supMessages.seq, query.after))).orderBy(asc(supMessages.seq)).limit(query.limit)
  } else {
    const before = query.before !== undefined ? [lt(supMessages.seq, query.before)] : []
    const desc_ = await select.where(and(...conditions, ...before)).orderBy(desc(supMessages.seq)).limit(query.limit + 1)
    hasMoreBefore = desc_.length > query.limit
    rows = desc_.slice(0, query.limit).reverse()
  }

  const attachments = await attachmentsForMessages(rows.filter((m) => !m.deletedAt).map((m) => m.id))
  const messages: MessageView[] = rows.map((m) => ({
    id: m.id,
    seq: m.seq,
    kind: m.kind,
    author:
      m.kind === 'system'
        ? null
        : {
            id: m.authorId ?? '',
            name: m.authorId
              ? personName({ fullName: m.authorFullName, labName: m.authorLabName, role: m.authorRole })
              : m.kind === 'note'
                ? 'Support team'
                : 'Deleted user',
            side: m.kind === 'customer' ? 'customer' : m.kind === 'agent' || m.kind === 'note' ? 'agent' : sideOf(m.authorRole),
          },
    body: m.deletedAt ? '' : m.body,
    attachments: attachments.get(m.id) ?? [],
    createdAt: m.createdAt.toISOString(),
    editedAt: iso(m.editedAt),
    deleted: Boolean(m.deletedAt),
  }))
  return { messages, hasMoreBefore }
}

/** Badge counts for the sidebar and the widget. */
export async function getSummary(actor: SupportActor): Promise<SupportSummary> {
  const side = viewerSide(actor)
  const unreadSql = sql<number>`count(*) filter (where ${supTickets.lastMessageSeq} > coalesce(${supReads.lastReadSeq}, 0)
    and ${supTickets.lastPublicSender}::text is distinct from ${side}
    ${isAgent(actor) ? sql`and ${supTickets.status} <> 'closed' and (${supTickets.assigneeId} = ${actor.id} or ${supTickets.assigneeId} is null)` : sql``})`

  const [row] = await db
    .select({
      unread: unreadSql.mapWith(Number),
      newCount: sql<number>`count(*) filter (where ${supTickets.status} = 'new')`.mapWith(Number),
      mine: sql<number>`count(*) filter (where ${supTickets.assigneeId} = ${actor.id} and ${supTickets.status} <> 'closed')`.mapWith(Number),
    })
    .from(supTickets)
    .leftJoin(supReads, and(eq(supReads.ticketId, supTickets.id), eq(supReads.userId, actor.id)))
    .where(scopeCondition(actor))

  return {
    unread: row?.unread ?? 0,
    newCount: isAgent(actor) ? (row?.newCount ?? 0) : 0,
    mine: isAgent(actor) ? (row?.mine ?? 0) : 0,
  }
}

/** Active support agents, for the assignment menu. */
export async function listAgents(): Promise<PersonRef[]> {
  const rows = await db
    .select({ id: profiles.id, fullName: profiles.fullName, labName: profiles.labName, role: profiles.role })
    .from(profiles)
    .where(and(eq(profiles.status, 'active'), inArray(profiles.role, [...AGENT_ROLES])))
    .orderBy(asc(profiles.fullName))
  return rows.map((r) => ({ id: r.id, name: personName(r) }))
}
