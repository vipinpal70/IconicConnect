/**
 * Phase 4 agent tools against a real Postgres (saved replies, linked conversations, lab context). Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… npx vitest run support-agent-tools
 *
 * Creates throwaway labs/agents and removes everything it created. Never point this at production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/support/notify', () => ({
  notifyTicketCreated: vi.fn(async () => {}),
  notifyNewMessage: vi.fn(async () => {}),
  notifyStatusChange: vi.fn(async () => {}),
  notifyAssigned: vi.fn(async () => {}),
}))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('support agent tools (database)', async () => {
  const { db } = await import('@/src/db')
  const { sql, inArray } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { supCannedReplies, supTickets } = await import('@/src/db/schema/support')
  const service = await import('@/src/lib/support/service')
  const queries = await import('@/src/lib/support/queries')
  const tools = await import('@/src/lib/support/agent-tools')

  type Caller = Parameters<typeof service.createTicket>[0]
  const ids: string[] = []
  const callers: Record<string, Caller> = {}

  async function makeUser(key: string, role: string, userType: 'lab_portal' | 'admin_portal', clientOf?: string) {
    const id = crypto.randomUUID()
    ids.push(id)
    await db.insert(users).values({ id, email: `support-test-${id}@example.invalid`, passwordHash: 'x' })
    const clientId = role === 'client' ? id : clientOf ?? null
    const labName = role === 'client' ? `Tools Lab ${key} ${id.slice(0, 6)}` : null
    await db.insert(profiles).values({ id, userType, role: role as never, status: 'active', clientId, fullName: `Test ${key}`, labName })
    callers[key] = { actor: { id, role, clientId }, profile: { id, userType, role: role as never, fullName: `Test ${key}`, labName, clientId } }
    return id
  }

  const newTicket = async (caller: Caller, subject: string) =>
    (await service.createTicket(caller, { subject, category: 'technical', message: 'Hello', clientMsgId: crypto.randomUUID() })).ticketId
  const numberOf = async (id: string) => (await queries.getTicketDetail(callers.agent.actor, id))!.number

  let labA = ''
  let labB = ''
  beforeAll(async () => {
    labA = await makeUser('labA', 'client', 'lab_portal')
    labB = await makeUser('labB', 'client', 'lab_portal')
    await makeUser('agent', 'qc', 'admin_portal')
    await makeUser('agent2', 'qc', 'admin_portal')
    await makeUser('admin', 'admin', 'admin_portal')
  })

  afterAll(async () => {
    if (ids.length === 0) return
    await db.delete(supCannedReplies).where(inArray(supCannedReplies.createdBy, ids))
    await db.delete(supTickets).where(inArray(supTickets.clientId, ids))
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.execute(sql`delete from notifications where user_id in ${ids}`)
    await db.delete(users).where(inArray(users.id, ids))
  })

  describe('saved replies', () => {
    it('keeps personal replies private and lets only admins share', async () => {
      const mine = await tools.createCannedReply(callers.agent.actor, { title: 'Refund steps', body: 'Hi {{name}}', shortcut: 'refund-t', shared: false })
      expect(mine).toMatchObject({ shared: false, editable: true, shortcut: 'refund-t' })

      const otherList = await tools.listCannedReplies(callers.agent2.actor)
      expect(otherList.map((r) => r.id)).not.toContain(mine.id)
      // Seeded shared replies are visible to every agent
      expect(otherList.some((r) => r.shared && r.shortcut === 'hi')).toBe(true)

      await expect(
        tools.createCannedReply(callers.agent.actor, { title: 'x', body: 'y', shortcut: null, shared: true }),
      ).rejects.toMatchObject({ status: 403 })
      const shared = await tools.createCannedReply(callers.admin.actor, { title: 'Team reply', body: 'Thanks', shortcut: 'team-t', shared: true })
      const asAgent = (await tools.listCannedReplies(callers.agent.actor)).find((r) => r.id === shared.id)
      expect(asAgent).toMatchObject({ shared: true, editable: false })
    })

    it('rejects labs, duplicate shortcuts, and edits by the wrong person', async () => {
      await expect(tools.listCannedReplies(callers.labA.actor)).rejects.toMatchObject({ status: 403 })

      await expect(
        tools.createCannedReply(callers.agent.actor, { title: 'dup', body: 'b', shortcut: 'refund-t', shared: false }),
      ).rejects.toMatchObject({ status: 409 })
      // Same shortcut is fine for a different person
      const theirs = await tools.createCannedReply(callers.agent2.actor, { title: 'Mine too', body: 'b', shortcut: 'refund-t', shared: false })

      await expect(tools.updateCannedReply(callers.agent.actor, theirs.id, { title: 'hijack' })).rejects.toMatchObject({ status: 404 })
      await expect(tools.deleteCannedReply(callers.agent.actor, theirs.id)).rejects.toMatchObject({ status: 404 })

      const sharedId = (await tools.listCannedReplies(callers.agent.actor)).find((r) => r.shortcut === 'team-t')!.id
      await expect(tools.updateCannedReply(callers.agent.actor, sharedId, { body: 'changed' })).rejects.toMatchObject({ status: 403 })

      const updated = await tools.updateCannedReply(callers.agent2.actor, theirs.id, { title: 'Renamed' })
      expect(updated.title).toBe('Renamed')
      await tools.deleteCannedReply(callers.agent2.actor, theirs.id)
      expect((await tools.listCannedReplies(callers.agent2.actor)).map((r) => r.id)).not.toContain(theirs.id)
    })
  })

  describe('linked conversations', () => {
    it('links within the same lab by number, shows it to both sides, and unlinks', async () => {
      const first = await newTicket(callers.labA, 'Scanner keeps disconnecting')
      const second = await newTicket(callers.labA, 'Scanner again')
      const firstNumber = await numberOf(first)

      // Number formats agents actually type: "SUP-000123", "sup123", "123"
      const bare = firstNumber.replace(/^SUP-0*/i, '')
      await service.applyTicketAction(callers.agent, second, { action: 'link', ticketNumber: `sup${bare}` })
      const agentView = await queries.getTicketDetail(callers.agent.actor, second)
      expect(agentView?.linkedTicket).toMatchObject({ id: first, number: firstNumber })
      const labView = await queries.getTicketDetail(callers.labA.actor, second)
      expect(labView?.linkedTicket?.id).toBe(first)

      await service.applyTicketAction(callers.agent, second, { action: 'link', ticketNumber: null })
      expect((await queries.getTicketDetail(callers.agent.actor, second))?.linkedTicket).toBeNull()
    })

    it('refuses another lab’s conversation, itself, garbage, and lab users', async () => {
      const mine = await newTicket(callers.labA, 'Mine')
      const theirs = await newTicket(callers.labB, 'Theirs')
      const link = (ticketNumber: string, caller = callers.agent) => service.applyTicketAction(caller, mine, { action: 'link', ticketNumber })

      await expect(link(await numberOf(theirs))).rejects.toMatchObject({ status: 400 })
      await expect(link(await numberOf(mine))).rejects.toMatchObject({ status: 400 })
      await expect(link('not-a-number')).rejects.toMatchObject({ status: 400 })
      await expect(link(await numberOf(mine), callers.labA)).rejects.toMatchObject({ status: 403 })
      expect((await queries.getTicketDetail(callers.agent.actor, mine))?.linkedTicket).toBeNull()
    })
  })

  describe('lab context', () => {
    it('summarises the lab for agents only and excludes the open conversation', async () => {
      const current = await newTicket(callers.labA, 'Current one')
      const context = await tools.customerContext(callers.agent.actor, labA, current)
      expect(context.lab).toMatchObject({ id: labA, members: 1 })
      expect(context.conversations.recent.map((t) => t.id)).not.toContain(current)
      expect(context.conversations.total).toBeGreaterThanOrEqual(context.conversations.recent.length)
      expect(context.cases).toMatchObject({ total: 0, open: 0, recent: [] })

      await expect(tools.customerContext(callers.labA.actor, labA)).rejects.toMatchObject({ status: 403 })
      await expect(tools.customerContext(callers.labB.actor, labA)).rejects.toMatchObject({ status: 403 })
      await expect(tools.customerContext(callers.agent.actor, crypto.randomUUID())).rejects.toMatchObject({ status: 404 })
      void labB
    })
  })
})
