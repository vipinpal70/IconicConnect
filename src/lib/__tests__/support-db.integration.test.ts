/**
 * Support system against a real Postgres (the migrated dev database). Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… npx vitest run support-db
 *
 * Creates throwaway labs/agents, exercises the service + queries end to end, and removes everything it
 * created. Never point this at production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/support/notify', () => ({
  notifyTicketCreated: vi.fn(async () => {}),
  notifyNewMessage: vi.fn(async () => {}),
  notifyStatusChange: vi.fn(async () => {}),
  notifyAssigned: vi.fn(async () => {}),
}))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('support system (database)', async () => {
  const { db } = await import('@/src/db')
  const { sql, eq, inArray } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { supMessages, supTickets } = await import('@/src/db/schema/support')
  const service = await import('@/src/lib/support/service')
  const queries = await import('@/src/lib/support/queries')
  const notify = await import('@/src/lib/support/notify')
  const { SupportError } = await import('@/src/lib/support/http')

  type Caller = Parameters<typeof service.createTicket>[0]
  const ids: string[] = []
  const callers: Record<string, Caller> = {}

  async function makeUser(key: string, role: string, userType: 'lab_portal' | 'admin_portal', clientOf?: string) {
    const id = crypto.randomUUID()
    ids.push(id)
    await db.insert(users).values({ id, email: `support-test-${id}@example.invalid`, passwordHash: 'x' })
    const clientId = role === 'client' ? id : clientOf ?? null
    await db.insert(profiles).values({
      id,
      userType,
      role: role as never,
      status: 'active',
      clientId,
      fullName: `Test ${key}`,
      labName: role === 'client' ? `Test Lab ${key}` : null,
    })
    callers[key] = { actor: { id, role, clientId }, profile: { id, userType, role: role as never, fullName: `Test ${key}`, labName: role === 'client' ? `Test Lab ${key}` : null, clientId } }
    return id
  }

  beforeAll(async () => {
    const labA = await makeUser('labA', 'client', 'lab_portal')
    await makeUser('memberA', 'subuser', 'lab_portal', labA)
    await makeUser('labB', 'client', 'lab_portal')
    await makeUser('agent', 'qc', 'admin_portal')
    await makeUser('agent2', 'admin', 'admin_portal')
  })

  afterAll(async () => {
    if (ids.length === 0) return
    await db.delete(supTickets).where(inArray(supTickets.clientId, ids))
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.execute(sql`delete from notifications where user_id in ${ids}`)
    await db.delete(users).where(inArray(users.id, ids))
  })

  const uuid = () => crypto.randomUUID()
  let ticketId = ''

  it('creates a conversation idempotently, visible to the whole lab only', async () => {
    const clientMsgId = uuid()
    const input = { subject: 'Upload stops at 80%', category: 'technical' as const, message: 'Help please', clientMsgId }
    const first = await service.createTicket(callers.memberA, input)
    const again = await service.createTicket(callers.memberA, input)
    expect(first.created).toBe(true)
    expect(again).toEqual({ ticketId: first.ticketId, created: false })
    ticketId = first.ticketId

    const ownerView = await queries.getTicketDetail(callers.labA.actor, ticketId)
    expect(ownerView).toMatchObject({ status: 'new', priority: 'normal', viewerSide: 'customer', actions: ['close'] })
    expect(await queries.getTicketDetail(callers.labB.actor, ticketId)).toBeNull()
    const labBList = await queries.listTickets(callers.labB.actor, { view: 'all', limit: 25 })
    expect(labBList.tickets.map((t) => t.id)).not.toContain(ticketId)
    expect(notify.notifyTicketCreated).toHaveBeenCalledTimes(1)
  })

  it('rejects another lab writing or reading the thread', async () => {
    await expect(
      service.postMessage(callers.labB, ticketId, { body: 'hi', visibility: 'public', clientMsgId: uuid() }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(service.markRead(callers.labB, ticketId, 1)).rejects.toBeInstanceOf(SupportError)
    expect(await queries.isTicketVisible(callers.labB.actor, ticketId)).toBe(false)
  })

  it('keeps internal notes away from the lab and does not notify it', async () => {
    vi.mocked(notify.notifyNewMessage).mockClear()
    await service.postMessage(callers.agent, ticketId, { body: 'Looks like a proxy limit', visibility: 'note', clientMsgId: uuid() })
    await expect(
      service.postMessage(callers.labA, ticketId, { body: 'sneaky', visibility: 'note', clientMsgId: uuid() }),
    ).rejects.toMatchObject({ status: 403 })

    const labThread = await queries.listMessages(callers.labA.actor, ticketId, { limit: 50 })
    const agentThread = await queries.listMessages(callers.agent.actor, ticketId, { limit: 50 })
    expect(labThread.messages.map((m) => m.kind)).not.toContain('note')
    expect(agentThread.messages.map((m) => m.kind)).toContain('note')
    expect(notify.notifyNewMessage).not.toHaveBeenCalled()
    // A note is not a reply: still New, nothing unread for the lab
    expect((await queries.getTicketDetail(callers.labA.actor, ticketId))?.status).toBe('new')
    expect((await queries.getSummary(callers.labA.actor)).unread).toBe(0)
  })

  it('goes Live on the first agent reply, shows unread to the lab until read', async () => {
    const msgId = uuid()
    const reply = await service.postMessage(callers.agent, ticketId, { body: 'Try the desktop uploader', visibility: 'public', clientMsgId: msgId })
    const duplicate = await service.postMessage(callers.agent, ticketId, { body: 'Try the desktop uploader', visibility: 'public', clientMsgId: msgId })
    expect(duplicate).toMatchObject({ created: false, message: { id: reply.message.id } })

    const [row] = await db.select().from(supTickets).where(eq(supTickets.id, ticketId))
    expect(row.status).toBe('live')
    expect(row.firstRespondedAt).not.toBeNull()
    expect(row.lastPublicSender).toBe('agent')

    expect((await queries.getSummary(callers.labA.actor)).unread).toBe(1)
    const list = await queries.listTickets(callers.memberA.actor, { view: 'open', limit: 25 })
    expect(list.tickets.find((t) => t.id === ticketId)).toMatchObject({ unread: true, preview: 'Try the desktop uploader' })

    await service.markRead(callers.labA, ticketId, reply.message.seq)
    expect((await queries.getSummary(callers.labA.actor)).unread).toBe(0)
    expect((await queries.getTicketDetail(callers.agent.actor, ticketId))?.otherSideReadSeq).toBe(reply.message.seq)
  })

  it('lets the lab close and reopen within the window, not after it', async () => {
    await service.applyTicketAction(callers.labA, ticketId, { action: 'close' })
    expect((await queries.getTicketDetail(callers.labA.actor, ticketId))).toMatchObject({ status: 'closed', closeReason: 'resolved', actions: ['reopen'] })

    await service.postMessage(callers.memberA, ticketId, { body: 'Still broken', visibility: 'public', clientMsgId: uuid() })
    const reopened = await queries.getTicketDetail(callers.agent.actor, ticketId)
    expect(reopened).toMatchObject({ status: 'live', reopenedCount: 1 })
    const thread = await queries.listMessages(callers.labA.actor, ticketId, { limit: 50 })
    const tail = thread.messages.slice(-2).map((m) => [m.kind, m.body])
    expect(tail).toEqual([['system', 'Conversation reopened by Test memberA'], ['customer', 'Still broken']])

    // Closed long ago: the lab must start a new conversation; an agent can still reopen
    await service.applyTicketAction(callers.agent, ticketId, { action: 'close', reason: 'resolved' })
    await db.update(supTickets).set({ closedAt: new Date(Date.now() - 20 * 86_400_000) }).where(eq(supTickets.id, ticketId))
    await expect(
      service.postMessage(callers.labA, ticketId, { body: 'hello?', visibility: 'public', clientMsgId: uuid() }),
    ).rejects.toMatchObject({ status: 409, code: 'closed' })
    await service.applyTicketAction(callers.agent, ticketId, { action: 'reopen' })
    expect((await queries.getTicketDetail(callers.agent.actor, ticketId))?.status).toBe('live')
  })

  it('assigns only to active agents and announces it', async () => {
    await expect(
      service.applyTicketAction(callers.agent, ticketId, { action: 'assign', assigneeId: callers.labA.actor.id }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_assignee' })
    await expect(service.applyTicketAction(callers.labA, ticketId, { action: 'assign', assigneeId: callers.agent.actor.id }))
      .rejects.toMatchObject({ status: 403 })

    await service.applyTicketAction(callers.agent, ticketId, { action: 'assign', assigneeId: callers.agent2.actor.id })
    const detail = await queries.getTicketDetail(callers.agent2.actor, ticketId)
    expect(detail?.assignee?.id).toBe(callers.agent2.actor.id)
    const mine = await queries.listTickets(callers.agent2.actor, { view: 'mine', limit: 25 })
    expect(mine.tickets.map((t) => t.id)).toContain(ticketId)
    const [last] = await db.select({ body: supMessages.body }).from(supMessages)
      .where(eq(supMessages.ticketId, ticketId)).orderBy(sql`${supMessages.seq} desc`).limit(1)
    expect(last.body).toBe('Test agent2 is now handling this conversation')
  })

  it('searches by number and message text, and pages with a cursor', async () => {
    const detail = await queries.getTicketDetail(callers.agent.actor, ticketId)
    const byNumber = await queries.listTickets(callers.agent.actor, { view: 'all', q: detail!.number, limit: 25 })
    expect(byNumber.tickets.map((t) => t.id)).toEqual([ticketId])
    const byBody = await queries.listTickets(callers.labA.actor, { view: 'all', q: 'uploader', limit: 25 })
    expect(byBody.tickets.map((t) => t.id)).toEqual([ticketId])
    // Notes are searchable by agents only
    expect((await queries.listTickets(callers.labA.actor, { view: 'all', q: 'proxy', limit: 25 })).tickets).toHaveLength(0)
    expect((await queries.listTickets(callers.agent.actor, { view: 'all', q: 'proxy', limit: 25 })).tickets.map((t) => t.id)).toContain(ticketId)

    for (let i = 0; i < 3; i++) {
      await service.createTicket(callers.labA, { subject: `Paging ${i}`, category: 'other', message: `Body ${i}` })
    }
    const page1 = await queries.listTickets(callers.labA.actor, { view: 'all', limit: 2 })
    const page2 = await queries.listTickets(callers.labA.actor, { view: 'all', limit: 2, cursor: page1.nextCursor! })
    expect(page1.tickets).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()
    const seen = [...page1.tickets, ...page2.tickets].map((t) => t.id)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toContain(ticketId)
  })

  it('lets an agent open a conversation for a lab (already Live and theirs)', async () => {
    const { ticketId: id } = await service.createTicket(callers.agent, {
      subject: 'About your last invoice',
      category: 'billing',
      message: 'We noticed a duplicate charge',
      clientId: callers.labA.actor.id,
      priority: 'high',
    })
    expect(await queries.getTicketDetail(callers.memberA.actor, id)).toMatchObject({
      status: 'live',
      priority: 'high',
      assignee: { id: callers.agent.actor.id },
      unread: true,
    })
    await expect(service.createTicket(callers.labB, { subject: 'Not mine', category: 'other', message: 'x', clientId: callers.labA.actor.id }))
      .resolves.toMatchObject({ created: true }) // customers' clientId input is ignored: it lands in their own lab
    const [own] = await db.select({ clientId: supTickets.clientId }).from(supTickets).where(eq(supTickets.subject, 'Not mine'))
    expect(own.clientId).toBe(callers.labB.actor.id)
  })
})
