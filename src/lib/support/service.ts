import { and, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { supEvents, supMessages, supReads, supSlaPolicies, supTickets } from '@/src/db/schema/support'
import { logActivity } from '@/src/lib/activity-log'
import { AGENT_ROLES, AUTO_CLOSE_DAYS, formatTicketNumber, type SupportPriority, type SupportSide } from './constants'
import { SupportError, notFound, type SupportProfile } from './http'
import {
  AUTO_CLOSE_WARNING,
  onAction,
  onAutoClose,
  onPublicMessage,
  shouldAutoClose,
  shouldWarnAutoClose,
  type LifecycleResult,
  type LifecycleState,
} from './lifecycle'
import {
  notifyAssigned,
  notifyAutoClosed,
  notifyAutoCloseWarning,
  notifyNewMessage,
  notifyRated,
  notifySlaAlert,
  notifyStatusChange,
  notifyTicketCreated,
  type NotifyActor,
  type NotifyTicket,
} from './notify'
import { allowedActions, canCreateTicketFor, canRate, canViewTicket, checkPost, isAgent, type SupportActor } from './policy'
import { personName } from './queries'
import { attachmentsForMessages, bindAttachmentsTx } from './attachments'
import { publishToAgents, publishToBoth } from './realtime'
import { DEFAULT_SLA_POLICIES, SLA_STOPPED, nextSlaClock, slaDeadlines, type SlaAlertLevel, type SlaPolicy } from './sla'
import type { MessageView } from './types'
import type { ActionRequest, CreateTicketInput, PostMessageInput, RateInput } from './validation'

/**
 * Write side of the support system: the only code that changes support tables. Each operation runs in
 * one transaction with the ticket row locked, applies the policy and lifecycle rules, writes audit
 * events, and only after commit sends notifications.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export interface SupportCaller {
  actor: SupportActor
  profile: SupportProfile
}

const sideOf = (actor: SupportActor): SupportSide => (isAgent(actor) ? 'agent' : 'customer')
const notifyActor = ({ actor, profile }: SupportCaller): NotifyActor => ({ id: actor.id, name: personName(profile), side: sideOf(actor) })

function toNotifyTicket(t: { id: string; number: number; subject: string; clientId: string; createdBy: string | null; assigneeId: string | null }): NotifyTicket {
  return { id: t.id, number: formatTicketNumber(t.number), subject: t.subject, clientId: t.clientId, createdBy: t.createdBy, assigneeId: t.assigneeId }
}

async function markReadTx(tx: Tx, ticketId: string, userId: string, seq: number) {
  await tx
    .insert(supReads)
    .values({ ticketId, userId, lastReadSeq: seq })
    .onConflictDoUpdate({
      target: [supReads.ticketId, supReads.userId],
      set: { lastReadSeq: sql`greatest(${supReads.lastReadSeq}, excluded.last_read_seq)`, updatedAt: new Date() },
    })
}

async function lockTicket(tx: Tx, ticketId: string) {
  const [ticket] = await tx.select().from(supTickets).where(eq(supTickets.id, ticketId)).for('update').limit(1)
  return ticket ?? null
}

/** Applies a lifecycle result: column patch, public system lines (bumping last activity) and audit events. */
async function applyLifecycle(tx: Tx, ticketId: string, actorId: string | null, result: LifecycleResult, now: Date) {
  let lastSystemSeq: number | null = null
  for (const body of result.systemMessages) {
    const [row] = await tx
      .insert(supMessages)
      .values({ ticketId, kind: 'system', authorId: null, body, createdAt: now })
      .returning({ seq: supMessages.seq })
    lastSystemSeq = row.seq
  }
  const patch: Record<string, unknown> = { ...result.patch }
  if (lastSystemSeq !== null) {
    patch.lastMessageSeq = lastSystemSeq
    patch.lastMessageAt = now
  }
  if (Object.keys(patch).length > 0) await tx.update(supTickets).set(patch).where(eq(supTickets.id, ticketId))
  if (result.events.length > 0) {
    await tx.insert(supEvents).values(
      result.events.map((e) => ({ ticketId, actorId, type: e.type, fromValue: e.from, toValue: e.to, createdAt: now })),
    )
  }
}

// ── Reply clock (SLA) ─────────────────────────────────────────────────────────────────────────────

type TicketRow = typeof supTickets.$inferSelect
type SlaPolicies = Record<SupportPriority, SlaPolicy>
const DAY_MS = 24 * 60 * 60 * 1000

let policyCache: { loadedAt: number; policies: SlaPolicies } | null = null

/** Targets per priority; cached for a minute per process (they change rarely). Defaults if the table is empty. */
export async function loadSlaPolicies(): Promise<SlaPolicies> {
  if (policyCache && Date.now() - policyCache.loadedAt < 60_000) return policyCache.policies
  const policies: SlaPolicies = { ...DEFAULT_SLA_POLICIES }
  for (const row of await db.select().from(supSlaPolicies)) {
    policies[row.priority] = { firstResponseMinutes: row.firstResponseMinutes, nextResponseMinutes: row.nextResponseMinutes }
  }
  policyCache = { loadedAt: Date.now(), policies }
  return policies
}

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null)

/** Column changes that keep the reply clock and the first-response target in line with the ticket after a change. */
function slaPatch(after: TicketRow, policies: SlaPolicies, now: Date): Partial<TicketRow> {
  const next = nextSlaClock(
    {
      status: after.status,
      priority: after.priority,
      lastPublicSender: after.lastPublicSender,
      firstResponded: Boolean(after.firstRespondedAt),
      current: {
        slaStartedAt: after.slaStartedAt,
        replyDueAt: after.replyDueAt,
        replyWarnAt: after.replyWarnAt,
        slaAlertLevel: after.slaAlertLevel as SlaAlertLevel,
      },
    },
    policies[after.priority],
    now,
  )
  const patch: Partial<TicketRow> = {}
  if (!sameTime(next.slaStartedAt, after.slaStartedAt) || !sameTime(next.replyDueAt, after.replyDueAt) || next.slaAlertLevel !== after.slaAlertLevel) {
    Object.assign(patch, next)
  }
  // The first-response target follows the priority until support has replied (reporting uses it)
  if (!after.firstRespondedAt && after.source !== 'agent') {
    const due = slaDeadlines(after.createdAt, policies[after.priority], false).dueAt
    if (!sameTime(due, after.firstResponseDueAt)) patch.firstResponseDueAt = due
  }
  return patch
}

function stateOf(ticket: typeof supTickets.$inferSelect): LifecycleState {
  return {
    status: ticket.status,
    assigneeId: ticket.assigneeId,
    priority: ticket.priority,
    category: ticket.category,
    firstRespondedAt: ticket.firstRespondedAt,
    closedAt: ticket.closedAt,
    closeReason: ticket.closeReason,
    reopenedCount: ticket.reopenedCount,
    linkedTicketId: ticket.linkedTicketId,
  }
}

/** "SUP-000123" / "123" → a conversation of the same lab (never itself); null unlinks. */
async function resolveLink(tx: Tx, ticket: typeof supTickets.$inferSelect, ticketNumber: string | null) {
  const previous = ticket.linkedTicketId
    ? (await tx.select({ number: supTickets.number }).from(supTickets).where(eq(supTickets.id, ticket.linkedTicketId)).limit(1))[0]
    : undefined
  const previousNumber = previous ? formatTicketNumber(previous.number) : null
  if (ticketNumber === null || ticketNumber === '') {
    return { action: 'link' as const, linkedTicketId: null, linkedNumber: null, previousNumber }
  }
  const match = /^(?:sup-?)?0*(\d{1,12})$/i.exec(ticketNumber)
  const [target] = match
    ? await tx
        .select({ id: supTickets.id, number: supTickets.number })
        .from(supTickets)
        .where(and(eq(supTickets.number, Number(match[1])), eq(supTickets.clientId, ticket.clientId)))
        .limit(1)
    : []
  if (!target || target.id === ticket.id) {
    throw new SupportError(400, 'link_not_found', 'No other conversation with that number for this lab')
  }
  return { action: 'link' as const, linkedTicketId: target.id, linkedNumber: formatTicketNumber(target.number), previousNumber }
}

async function messageView(
  row: { id: string; seq: number; kind: MessageView['kind']; body: string; createdAt: Date },
  caller: SupportCaller,
): Promise<MessageView> {
  const attachments = await attachmentsForMessages([row.id])
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    author: row.kind === 'system' ? null : { id: caller.actor.id, name: personName(caller.profile), side: sideOf(caller.actor) },
    body: row.body,
    attachments: attachments.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
    editedAt: null,
    deleted: false,
  }
}

// ── Create ────────────────────────────────────────────────────────────────────────────────────────

export async function createTicket(caller: SupportCaller, input: CreateTicketInput, now = new Date()) {
  const { actor, profile } = caller
  const agent = isAgent(actor)
  const clientId = agent ? input.clientId : actor.clientId
  if (!clientId) throw new SupportError(400, 'lab_required', 'Choose the lab this conversation is with')
  if (!canCreateTicketFor(actor, clientId)) throw new SupportError(403, 'forbidden', 'You cannot start a conversation for this lab')

  const [labRow] = await db
    .select({ id: profiles.id, labName: profiles.labName, fullName: profiles.fullName })
    .from(profiles)
    .where(and(eq(profiles.id, clientId), eq(profiles.role, 'client')))
    .limit(1)
  if (!labRow) throw new SupportError(400, 'lab_not_found', 'That lab does not exist')

  if (input.relatedCaseId) {
    const [caseRow] = await db.select({ id: cases.id }).from(cases)
      .where(and(eq(cases.id, input.relatedCaseId), eq(cases.clientId, clientId))).limit(1)
    if (!caseRow) throw new SupportError(400, 'case_not_found', 'That case does not belong to this lab')
  }

  // Same browser-generated id = the same request retried (double click, flaky network)
  if (input.clientMsgId) {
    const [existing] = await db.select({ ticketId: supMessages.ticketId }).from(supMessages)
      .where(and(eq(supMessages.authorId, actor.id), eq(supMessages.clientMsgId, input.clientMsgId))).limit(1)
    if (existing) return { ticketId: existing.ticketId, created: false }
  }
  const policies = await loadSlaPolicies()

  const side = sideOf(actor)
  const priority: SupportPriority = agent ? (input.priority ?? 'normal') : 'normal'
  // A lab starting a conversation is waiting on support from now; support starting one is waiting on the lab
  const clock = agent
    ? { lastAgentReplyAt: now }
    : (() => {
        const { dueAt, warnAt } = slaDeadlines(now, policies[priority], false)
        return { firstResponseDueAt: dueAt, slaStartedAt: now, replyDueAt: dueAt, replyWarnAt: warnAt }
      })()
  const ticket = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(supTickets)
      .values({
        ...clock,
        clientId,
        createdBy: actor.id,
        subject: input.subject,
        category: input.category,
        priority,
        // An agent opening a conversation is already engaged with it and owns it
        status: agent ? 'live' : 'new',
        assigneeId: agent ? actor.id : null,
        source: agent ? 'agent' : (input.source ?? 'page'),
        relatedCaseId: input.relatedCaseId ?? null,
        firstRespondedAt: agent ? now : null,
        lastMessageAt: now,
        createdAt: now,
      })
      .returning()
    const [message] = await tx
      .insert(supMessages)
      .values({ ticketId: created.id, kind: side, authorId: actor.id, body: input.message, clientMsgId: input.clientMsgId ?? null, createdAt: now })
      .returning({ id: supMessages.id, seq: supMessages.seq })
    await bindAttachmentsTx(tx, input.attachmentIds ?? [], { actorId: actor.id, ticketId: created.id, clientId, messageId: message.id })
    await tx.update(supTickets)
      .set({ lastMessageSeq: message.seq, lastPublicSender: side })
      .where(eq(supTickets.id, created.id))
    await tx.insert(supEvents).values([
      { ticketId: created.id, actorId: actor.id, type: 'created', toValue: created.source, createdAt: now },
      ...(agent ? [{ ticketId: created.id, actorId: actor.id, type: 'assignee' as const, fromValue: null, toValue: actor.id, createdAt: now }] : []),
    ])
    await markReadTx(tx, created.id, actor.id, message.seq)
    return created
  })

  await publishToBoth(clientId, { type: 'message', ticketId: ticket.id, seq: 0 })
  const labName = labRow.labName || labRow.fullName || 'A lab'
  await notifyTicketCreated(toNotifyTicket(ticket), notifyActor(caller), labName)
  await logActivity({
    actor: profile,
    action: 'support.ticket_created',
    details: { ticketId: ticket.id, number: formatTicketNumber(ticket.number), category: ticket.category, source: ticket.source },
  }).catch((err) => console.error('[support.ticket_created logActivity]', err))

  return { ticketId: ticket.id, created: true }
}

// ── Messages ──────────────────────────────────────────────────────────────────────────────────────

export async function postMessage(caller: SupportCaller, ticketId: string, input: PostMessageInput, now = new Date()) {
  const { actor } = caller
  const side = sideOf(actor)
  const policies = await loadSlaPolicies()

  const outcome = await db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId)
    if (!ticket || !canViewTicket(actor, ticket)) throw notFound()

    const [existing] = await tx
      .select({ id: supMessages.id, seq: supMessages.seq, kind: supMessages.kind, body: supMessages.body, createdAt: supMessages.createdAt })
      .from(supMessages)
      .where(and(eq(supMessages.ticketId, ticketId), eq(supMessages.authorId, actor.id), eq(supMessages.clientMsgId, input.clientMsgId)))
      .limit(1)
    if (existing) return { message: existing, ticket, created: false, reopened: false }

    const check = checkPost(actor, ticket, input.visibility, now)
    if (!check.ok) {
      if (check.code === 'not_found') throw notFound()
      if (check.code === 'notes_are_for_staff') throw new SupportError(403, 'forbidden', 'Internal notes are for the support team only')
      throw new SupportError(409, 'closed', 'This conversation is closed. Start a new conversation to continue.')
    }

    if (input.visibility === 'note') {
      const [note] = await tx
        .insert(supMessages)
        .values({ ticketId, kind: 'note', authorId: actor.id, body: input.body, clientMsgId: input.clientMsgId, createdAt: now })
        .returning({ id: supMessages.id, seq: supMessages.seq, kind: supMessages.kind, body: supMessages.body, createdAt: supMessages.createdAt })
      await bindAttachmentsTx(tx, input.attachmentIds ?? [], { actorId: actor.id, ticketId, clientId: ticket.clientId, messageId: note.id })
      await markReadTx(tx, ticketId, actor.id, note.seq)
      return { message: note, ticket, created: true, reopened: false }
    }

    // System lines (e.g. "reopened") go first so the thread reads in order
    const transition = onPublicMessage(stateOf(ticket), side, now, { reopens: check.reopens, actorName: personName(caller.profile) })
    await applyLifecycle(tx, ticketId, actor.id, transition, now)

    const [message] = await tx
      .insert(supMessages)
      .values({ ticketId, kind: side, authorId: actor.id, body: input.body, clientMsgId: input.clientMsgId, createdAt: now })
      .returning({ id: supMessages.id, seq: supMessages.seq, kind: supMessages.kind, body: supMessages.body, createdAt: supMessages.createdAt })
    await bindAttachmentsTx(tx, input.attachmentIds ?? [], { actorId: actor.id, ticketId, clientId: ticket.clientId, messageId: message.id })
    const after: TicketRow = { ...ticket, ...transition.patch, lastPublicSender: side } as TicketRow
    await tx.update(supTickets)
      .set({
        lastMessageSeq: message.seq,
        lastMessageAt: now,
        lastPublicSender: side,
        // Any public message cancels a pending auto-close; a support reply restarts its countdown
        autoCloseWarnedAt: null,
        ...(side === 'agent' ? { lastAgentReplyAt: now } : {}),
        ...slaPatch(after, policies, now),
      })
      .where(eq(supTickets.id, ticketId))
    await markReadTx(tx, ticketId, actor.id, message.seq)
    return { message, ticket, created: true, reopened: check.reopens }
  })

  if (outcome.created) {
    // Live update after commit. A note is staff knowledge, so labs aren't even told one exists.
    const event = { type: 'message' as const, ticketId, seq: outcome.message.seq }
    if (outcome.message.kind === 'note') await publishToAgents(event)
    else await publishToBoth(outcome.ticket.clientId, event)
  }
  if (outcome.created && outcome.message.kind !== 'note') {
    const ticket = toNotifyTicket(outcome.ticket)
    if (outcome.reopened) await notifyStatusChange(ticket, notifyActor(caller), 'reopened')
    const count = input.attachmentIds?.length ?? 0
    const text = outcome.message.body || `Sent ${count === 1 ? 'an attachment' : `${count} attachments`}`
    await notifyNewMessage(ticket, notifyActor(caller), text)
  }
  return { message: await messageView(outcome.message, caller), created: outcome.created }
}

export async function markRead(caller: SupportCaller, ticketId: string, seq: number) {
  const [ticket] = await db
    .select({ clientId: supTickets.clientId, maxSeq: sql<number>`(select coalesce(max(seq), 0) from sup_messages where ticket_id = ${ticketId})`.mapWith(Number) })
    .from(supTickets)
    .where(eq(supTickets.id, ticketId))
    .limit(1)
  if (!ticket || !canViewTicket(caller.actor, ticket)) throw notFound()
  const readSeq = Math.min(seq, ticket.maxSeq)
  await db.transaction((tx) => markReadTx(tx, ticketId, caller.actor.id, readSeq))
  // Read receipts update live on the other side
  await publishToBoth(ticket.clientId, { type: 'read', ticketId, side: sideOf(caller.actor), seq: readSeq })
}

// ── Actions (close, reopen, assign, triage) ───────────────────────────────────────────────────────

export async function applyTicketAction(caller: SupportCaller, ticketId: string, request: ActionRequest, now = new Date()) {
  const { actor, profile } = caller
  let assigneeName: string | null = null
  if (request.action === 'assign' && request.assigneeId) {
    const [agentRow] = await db
      .select({ fullName: profiles.fullName, labName: profiles.labName, role: profiles.role })
      .from(profiles)
      .where(and(eq(profiles.id, request.assigneeId), eq(profiles.status, 'active'), inArray(profiles.role, [...AGENT_ROLES])))
      .limit(1)
    if (!agentRow) throw new SupportError(400, 'invalid_assignee', 'Choose an active support agent')
    assigneeName = personName(agentRow)
  }
  const policies = await loadSlaPolicies()

  const outcome = await db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId)
    if (!ticket || !canViewTicket(actor, ticket)) throw notFound()
    const permitted = allowedActions(actor, ticket, now)
    if (!permitted.includes(request.action)) {
      throw new SupportError(403, 'action_not_allowed', 'You cannot do that on this conversation right now')
    }
    const input =
      request.action === 'assign'
        ? { ...request, assigneeName }
        : request.action === 'link'
          ? await resolveLink(tx, ticket, request.ticketNumber)
          : request
    const result = onAction(stateOf(ticket), input, { id: actor.id, name: personName(profile) }, now)
    if (!result.ok) {
      if (result.code === 'no_change') return { ticket, changed: false }
      throw new SupportError(409, 'invalid_state', 'This conversation has changed. Refresh and try again.')
    }
    await applyLifecycle(tx, ticketId, actor.id, result.result, now)
    // Closing stops the clock, reopening may restart it, a new priority moves the deadline
    const after = { ...ticket, ...result.result.patch } as TicketRow
    const clock = slaPatch(after, policies, now)
    if (Object.keys(clock).length > 0) await tx.update(supTickets).set(clock).where(eq(supTickets.id, ticketId))
    return { ticket: after, changed: true }
  })

  if (!outcome.changed) return
  await publishToBoth(outcome.ticket.clientId, { type: 'ticket', ticketId })
  const notifyTicket = toNotifyTicket(outcome.ticket as typeof supTickets.$inferSelect)
  const who = notifyActor(caller)
  if (request.action === 'close') await notifyStatusChange(notifyTicket, who, 'closed')
  if (request.action === 'reopen') await notifyStatusChange(notifyTicket, who, 'reopened')
  if (request.action === 'assign' || request.action === 'claim') await notifyAssigned(notifyTicket, who)

  await logActivity({
    actor: profile,
    action: `support.${request.action}`,
    details: { ticketId, number: notifyTicket.number, ...request },
  }).catch((err) => console.error('[support action logActivity]', err))
}

// ── Ratings (CSAT) ────────────────────────────────────────────────────────────────────────────────

export async function rateTicket(caller: SupportCaller, ticketId: string, input: RateInput, now = new Date()) {
  const { actor, profile } = caller
  const ticket = await db.transaction(async (tx) => {
    const row = await lockTicket(tx, ticketId)
    if (!row || !canViewTicket(actor, row)) throw notFound()
    if (row.csatScore !== null) throw new SupportError(409, 'already_rated', 'This conversation has already been rated')
    if (!canRate(actor, row, now)) throw new SupportError(403, 'cannot_rate', 'This conversation cannot be rated')
    await tx
      .update(supTickets)
      .set({ csatScore: input.score, csatComment: input.comment?.trim() || null, csatAt: now })
      .where(eq(supTickets.id, ticketId))
    await tx.insert(supEvents).values({ ticketId, actorId: actor.id, type: 'rated', fromValue: null, toValue: String(input.score), createdAt: now })
    return row
  })

  await publishToBoth(ticket.clientId, { type: 'ticket', ticketId })
  await notifyRated(toNotifyTicket(ticket), notifyActor(caller), input.score)
  await logActivity({
    actor: profile,
    action: 'support.rated',
    details: { ticketId, number: formatTicketNumber(ticket.number), score: input.score },
  }).catch((err) => console.error('[support.rated logActivity]', err))
}

// ── Scheduled jobs (support-system.md §13) ────────────────────────────────────────────────────────

/**
 * Every minute: raise "due soon" (80 %) and "overdue" alerts. One atomic UPDATE claims each alert, so a
 * reply committed at the same moment wins (the row no longer matches) and two workers never double-send.
 */
export async function runSlaSweep(now = new Date()) {
  const fired = await db
    .update(supTickets)
    .set({ slaAlertLevel: sql`case when ${supTickets.replyDueAt} <= ${now.toISOString()}::timestamptz then 2 else 1 end` })
    .where(
      and(
        isNotNull(supTickets.replyDueAt),
        ne(supTickets.status, 'closed'),
        or(
          and(lt(supTickets.slaAlertLevel, 2), lte(supTickets.replyDueAt, now)),
          and(lt(supTickets.slaAlertLevel, 1), lte(supTickets.replyWarnAt, now)),
        ),
      ),
    )
    .returning()

  for (const ticket of fired) {
    await publishToAgents({ type: 'ticket', ticketId: ticket.id })
    await notifySlaAlert(toNotifyTicket(ticket), ticket.slaAlertLevel === 2 ? 2 : 1, ticket.replyDueAt!)
  }
  return { alerts: fired.length }
}

const SWEEP_BATCH = 200

/** Every 15 minutes: warn conversations waiting on the lab for 6 days, close them a day after the warning. */
export async function runAutoCloseSweep(now = new Date()) {
  const waitingOnLab = and(eq(supTickets.status, 'live'), eq(supTickets.lastPublicSender, 'agent'))

  const toWarn = await db
    .select({ id: supTickets.id })
    .from(supTickets)
    .where(and(waitingOnLab, isNull(supTickets.autoCloseWarnedAt), lte(supTickets.lastAgentReplyAt, new Date(now.getTime() - (AUTO_CLOSE_DAYS - 1) * DAY_MS))))
    .limit(SWEEP_BATCH)
  let warned = 0
  for (const { id } of toWarn) {
    // Re-checked under the row lock: the lab may have replied since the scan
    const ticket = await db.transaction(async (tx) => {
      const row = await lockTicket(tx, id)
      if (!row || !shouldWarnAutoClose(row, now)) return null
      await applyLifecycle(tx, id, null, { patch: {}, events: [], systemMessages: [AUTO_CLOSE_WARNING] }, now)
      await tx.update(supTickets).set({ autoCloseWarnedAt: now }).where(eq(supTickets.id, id))
      return row
    })
    if (!ticket) continue
    warned++
    await publishToBoth(ticket.clientId, { type: 'message', ticketId: id, seq: 0 })
    await notifyAutoCloseWarning(toNotifyTicket(ticket))
  }

  const toClose = await db
    .select({ id: supTickets.id })
    .from(supTickets)
    .where(and(waitingOnLab, lte(supTickets.autoCloseWarnedAt, new Date(now.getTime() - DAY_MS))))
    .limit(SWEEP_BATCH)
  let closed = 0
  for (const { id } of toClose) {
    const ticket = await db.transaction(async (tx) => {
      const row = await lockTicket(tx, id)
      if (!row || !shouldAutoClose(row, now)) return null
      await applyLifecycle(tx, id, null, onAutoClose(stateOf(row), now), now)
      await tx.update(supTickets).set({ ...SLA_STOPPED, autoCloseWarnedAt: null }).where(eq(supTickets.id, id))
      return row
    })
    if (!ticket) continue
    closed++
    await publishToBoth(ticket.clientId, { type: 'ticket', ticketId: id })
    await notifyAutoClosed(toNotifyTicket(ticket))
  }
  return { warned, closed }
}
