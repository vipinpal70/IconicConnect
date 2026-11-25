/**
 * Live events through real Redis pub/sub and the real service (support-system.md §11). Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=… REDIS_URL=redis://localhost:6380 npx vitest run support-realtime
 *
 * Proves what each channel is told: a lab's channel never learns about internal notes or other labs,
 * events carry ids only (no message text), and typing/read/ticket changes reach the right side.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/support/notify', () => ({
  notifyTicketCreated: vi.fn(async () => {}),
  notifyNewMessage: vi.fn(async () => {}),
  notifyStatusChange: vi.fn(async () => {}),
  notifyAssigned: vi.fn(async () => {}),
}))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('support live events (database + Redis)', async () => {
  const { db } = await import('@/src/db')
  const { sql, inArray } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { supTickets } = await import('@/src/db/schema/support')
  const service = await import('@/src/lib/support/service')
  const realtime = await import('@/src/lib/support/realtime')

  type Caller = Parameters<typeof service.createTicket>[0]
  type Event = Awaited<Parameters<Parameters<typeof realtime.subscribe>[1]>[0]>
  const ids: string[] = []
  const callers: Record<string, Caller> = {}
  const received: Record<'labA' | 'labB' | 'agents', Event[]> = { labA: [], labB: [], agents: [] }
  const unsubscribers: Array<() => void> = []
  const uuid = () => crypto.randomUUID()
  const settle = () => new Promise((r) => setTimeout(r, 300)) // pub/sub round trip through Redis

  async function makeUser(key: string, role: string, userType: 'lab_portal' | 'admin_portal') {
    const id = uuid()
    ids.push(id)
    await db.insert(users).values({ id, email: `support-rt-${id}@example.invalid`, passwordHash: 'x' })
    const clientId = role === 'client' ? id : null
    const labName = role === 'client' ? `RT Lab ${key}` : null
    await db.insert(profiles).values({ id, userType, role: role as never, status: 'active', clientId, fullName: `RT ${key}`, labName })
    callers[key] = { actor: { id, role, clientId }, profile: { id, userType, role: role as never, fullName: `RT ${key}`, labName, clientId } }
  }

  beforeAll(async () => {
    await makeUser('labA', 'client', 'lab_portal')
    await makeUser('labB', 'client', 'lab_portal')
    await makeUser('agent', 'qc', 'admin_portal')
    unsubscribers.push(realtime.subscribe([realtime.labChannel(callers.labA.actor.id)], (e) => received.labA.push(e)))
    unsubscribers.push(realtime.subscribe([realtime.labChannel(callers.labB.actor.id)], (e) => received.labB.push(e)))
    unsubscribers.push(realtime.subscribe([realtime.agentsChannel], (e) => received.agents.push(e)))
    await settle()
  })

  afterAll(async () => {
    unsubscribers.forEach((u) => u())
    if (ids.length === 0) return
    await db.delete(supTickets).where(inArray(supTickets.clientId, ids))
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.delete(users).where(inArray(users.id, ids))
  })

  const reset = () => Object.values(received).forEach((list) => (list.length = 0))
  let ticketId = ''

  it('tells the lab and the agents about a new conversation, and nobody else', async () => {
    reset()
    ;({ ticketId } = await service.createTicket(callers.labA, { subject: 'Live test', category: 'technical', message: 'Secret details 123' }))
    await settle()
    expect(received.labA).toContainEqual(expect.objectContaining({ type: 'message', ticketId }))
    expect(received.agents).toContainEqual(expect.objectContaining({ type: 'message', ticketId }))
    expect(received.labB).toHaveLength(0)
  })

  it('carries ids only, never message text', async () => {
    reset()
    await service.postMessage(callers.agent, ticketId, { body: 'Reply with secret 456', visibility: 'public', clientMsgId: uuid() })
    await settle()
    const serialized = JSON.stringify([...received.labA, ...received.agents])
    expect(serialized).not.toContain('secret')
    expect(received.labA).toContainEqual(expect.objectContaining({ type: 'message', ticketId, seq: expect.any(Number) }))
  })

  it('never tells the lab an internal note exists', async () => {
    reset()
    await service.postMessage(callers.agent, ticketId, { body: 'internal only', visibility: 'note', clientMsgId: uuid() })
    await settle()
    expect(received.agents).toContainEqual(expect.objectContaining({ type: 'message', ticketId }))
    expect(received.labA).toHaveLength(0)
  })

  it('announces status changes and read receipts to both sides', async () => {
    reset()
    await service.applyTicketAction(callers.agent, ticketId, { action: 'claim' })
    await service.markRead(callers.labA, ticketId, 999_999)
    await settle()
    for (const side of [received.labA, received.agents]) {
      expect(side).toContainEqual({ type: 'ticket', ticketId })
      expect(side).toContainEqual(expect.objectContaining({ type: 'read', ticketId, side: 'customer' }))
    }
    expect(received.labB).toHaveLength(0)
  })

  it('stays quiet when a retried send is deduplicated', async () => {
    const clientMsgId = uuid()
    await service.postMessage(callers.labA, ticketId, { body: 'once', visibility: 'public', clientMsgId })
    await settle()
    reset()
    await service.postMessage(callers.labA, ticketId, { body: 'once', visibility: 'public', clientMsgId })
    await settle()
    expect(received.labA).toHaveLength(0)
    // The agents channel is shared: other test files running in parallel publish there too
    expect(received.agents.filter((e) => e.ticketId === ticketId)).toHaveLength(0)
  })

  it('limits open streams per user and reports agents online', async () => {
    const user = uuid()
    const results = []
    for (let i = 0; i < realtime.MAX_STREAMS_PER_USER + 1; i++) results.push(await realtime.openStream(user, `conn-${i}`, true))
    expect(results.slice(0, realtime.MAX_STREAMS_PER_USER).every(Boolean)).toBe(true)
    expect(results.at(-1)).toBe(false)
    expect(await realtime.agentsOnline()).toBe(true)
    await realtime.closeStream(user, 'conn-0')
    expect(await realtime.openStream(user, 'conn-again', true)).toBe(true)
    for (let i = 1; i < realtime.MAX_STREAMS_PER_USER; i++) await realtime.closeStream(user, `conn-${i}`)
    await realtime.closeStream(user, 'conn-again')
  })
})
