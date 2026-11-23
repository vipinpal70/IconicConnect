/**
 * Phase 5 against a real Postgres + Redis: reply clock, SLA alerts, auto-close, ratings, email digests,
 * metrics. Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… REDIS_URL=redis://localhost:6380 npx vitest run support-sla.integration
 *
 * Email is never sent: the queue is mocked. Creates throwaway labs/agents and removes them. Never point this at production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/support/notify', () => ({
  notifyTicketCreated: vi.fn(async () => {}),
  notifyNewMessage: vi.fn(async () => {}),
  notifyStatusChange: vi.fn(async () => {}),
  notifyAssigned: vi.fn(async () => {}),
  notifySlaAlert: vi.fn(async () => {}),
  notifyAutoCloseWarning: vi.fn(async () => {}),
  notifyAutoClosed: vi.fn(async () => {}),
  notifyRated: vi.fn(async () => {}),
}))
vi.mock('@/src/lib/queue/jobs', () => ({ queueEmail: vi.fn(async () => ({ id: 'test' })) }))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('support SLA, auto-close, ratings, digests (database)', async () => {
  const { db } = await import('@/src/db')
  const { sql, eq, inArray } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { supEvents, supMessages, supTickets } = await import('@/src/db/schema/support')
  const service = await import('@/src/lib/support/service')
  const queries = await import('@/src/lib/support/queries')
  const tools = await import('@/src/lib/support/agent-tools')
  const digest = await import('@/src/lib/support/digest')
  const realtime = await import('@/src/lib/support/realtime')
  const notify = await import('@/src/lib/support/notify')
  const jobs = await import('@/src/lib/queue/jobs')
  const { setPreference } = await import('@/src/lib/notifications/preferences')

  type Caller = Parameters<typeof service.createTicket>[0]
  const ids: string[] = []
  const callers: Record<string, Caller> = {}
  const emails: Record<string, string> = {}

  async function makeUser(key: string, role: string, userType: 'lab_portal' | 'admin_portal', clientOf?: string) {
    const id = crypto.randomUUID()
    ids.push(id)
    emails[key] = `support-test-${id}@example.invalid`
    await db.insert(users).values({ id, email: emails[key], passwordHash: 'x' })
    const clientId = role === 'client' ? id : clientOf ?? null
    const labName = role === 'client' ? `SLA Lab ${key} ${id.slice(0, 6)}` : null
    await db.insert(profiles).values({ id, userType, role: role as never, status: 'active', clientId, fullName: `Test ${key}`, labName })
    callers[key] = { actor: { id, role, clientId }, profile: { id, userType, role: role as never, fullName: `Test ${key}`, labName, clientId } }
    return id
  }

  const { AUTO_CLOSE_WARNING: AUTO_WARNING } = await import('@/src/lib/support/lifecycle')
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR
  const uuid = () => crypto.randomUUID()
  const row = async (id: string) => (await db.select().from(supTickets).where(eq(supTickets.id, id)))[0]
  const open = async (caller: Caller, subject: string, now: Date) =>
    (await service.createTicket(caller, { subject, category: 'technical', message: 'Help', clientMsgId: uuid() }, now)).ticketId
  const say = (caller: Caller, ticketId: string, now: Date, visibility: 'public' | 'note' = 'public') =>
    service.postMessage(caller, ticketId, { body: `msg ${now.toISOString()}`, visibility, clientMsgId: uuid() }, now)
  // Earlier tests leave recent replies in other conversations: count only emails about `about`
  const emailsTo = (key: string, about: string) =>
    vi.mocked(jobs.queueEmail).mock.calls.filter(([d]) => d.to === emails[key] && d.subject.includes(about)).map(([d]) => d)

  beforeAll(async () => {
    const lab = await makeUser('lab', 'client', 'lab_portal')
    await makeUser('member', 'subuser', 'lab_portal', lab)
    await makeUser('other', 'client', 'lab_portal')
    await makeUser('agent', 'qc', 'admin_portal')
  })

  afterAll(async () => {
    if (ids.length === 0) return
    await db.delete(supTickets).where(inArray(supTickets.clientId, ids))
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.execute(sql`delete from notifications where user_id in ${ids}`)
    await db.delete(users).where(inArray(users.id, ids))
  })

  it('runs the reply clock: first reply target, stops on a reply (not a note), next target, priority, close', async () => {
    const t0 = new Date(Date.now() - 10 * HOUR)
    const id = await open(callers.member, 'Clock', t0)
    let r = await row(id)
    expect(r.replyDueAt).toEqual(new Date(t0.getTime() + 8 * HOUR))
    expect(r.firstResponseDueAt).toEqual(r.replyDueAt)

    await say(callers.agent, id, new Date(t0.getTime() + HOUR), 'note')
    expect((await row(id)).replyDueAt).toEqual(new Date(t0.getTime() + 8 * HOUR))

    await say(callers.agent, id, new Date(t0.getTime() + 2 * HOUR))
    r = await row(id)
    expect(r).toMatchObject({ slaStartedAt: null, replyDueAt: null, slaAlertLevel: 0 })
    expect(r.lastAgentReplyAt).toEqual(new Date(t0.getTime() + 2 * HOUR))

    const labAt = new Date(t0.getTime() + 3 * HOUR)
    await say(callers.lab, id, labAt)
    await say(callers.member, id, new Date(t0.getTime() + 4 * HOUR)) // second message: no extra time
    r = await row(id)
    expect(r.slaStartedAt).toEqual(labAt)
    expect(r.replyDueAt).toEqual(new Date(labAt.getTime() + 24 * HOUR))

    await service.applyTicketAction(callers.agent, id, { action: 'set_priority', priority: 'urgent' }, new Date(t0.getTime() + 5 * HOUR))
    expect((await row(id)).replyDueAt).toEqual(new Date(labAt.getTime() + 2 * HOUR))

    await service.applyTicketAction(callers.agent, id, { action: 'close', reason: 'resolved' }, new Date(t0.getTime() + 6 * HOUR))
    expect(await row(id)).toMatchObject({ replyDueAt: null, slaStartedAt: null })
  })

  it('alerts once at 80 % and once when overdue; a reply in time ends it', async () => {
    const now = new Date()
    const id = await open(callers.member, 'Alerts', new Date(now.getTime() - 7 * HOUR)) // normal: warn 6.4 h, due 8 h
    vi.mocked(notify.notifySlaAlert).mockClear()
    const mine = () => vi.mocked(notify.notifySlaAlert).mock.calls.filter(([t]) => t.id === id)

    await service.runSlaSweep(now)
    expect(mine().map(([, level]) => level)).toEqual([1])
    await service.runSlaSweep(now)
    expect(mine()).toHaveLength(1)

    await service.runSlaSweep(new Date(now.getTime() + 2 * HOUR))
    expect(mine().map(([, level]) => level)).toEqual([1, 2])
    expect((await queries.listTickets(callers.agent.actor, { view: 'overdue', limit: 50 })).tickets.map((t) => t.id)).not.toContain(id) // not yet overdue in real time
    const summary = await queries.getSummary(callers.agent.actor)
    expect(summary.overdue).toBeGreaterThanOrEqual(0)

    await say(callers.agent, id, new Date(now.getTime() + 2 * HOUR))
    await service.runSlaSweep(new Date(now.getTime() + 30 * HOUR))
    expect(mine()).toHaveLength(2)
  })

  it('lists overdue conversations for agents and hides deadlines from the lab', async () => {
    const id = await open(callers.member, 'Overdue one', new Date(Date.now() - 9 * HOUR))
    const overdue = await queries.listTickets(callers.agent.actor, { view: 'overdue', limit: 50 })
    expect(overdue.tickets.find((t) => t.id === id)?.replyDueAt).toBeTruthy()
    expect((await queries.getSummary(callers.agent.actor)).overdue).toBeGreaterThanOrEqual(1)
    const labView = await queries.getTicketDetail(callers.lab.actor, id)
    expect(labView).toMatchObject({ replyDueAt: null, replyWarnAt: null })
  })

  it('warns after 6 days without a lab reply, closes a day later as "No reply"', async () => {
    const start = new Date(Date.now() - 8 * DAY)
    const id = await open(callers.member, 'Goes quiet', start)
    await say(callers.agent, id, new Date(start.getTime() + HOUR))
    const now = new Date(start.getTime() + HOUR + 6 * DAY)

    expect((await service.runAutoCloseSweep(new Date(now.getTime() - HOUR))).warned).toBe(0)
    await service.runAutoCloseSweep(now)
    expect((await row(id)).autoCloseWarnedAt).toEqual(now)
    const thread = await queries.listMessages(callers.lab.actor, id, { limit: 50 })
    expect(thread.messages.at(-1)).toMatchObject({ kind: 'system' })
    expect(thread.messages.at(-1)?.body).toBe(AUTO_WARNING)
    expect(notify.notifyAutoCloseWarning).toHaveBeenCalled()
    await service.runAutoCloseSweep(new Date(now.getTime() + HOUR)) // no second warning
    const again = await queries.listMessages(callers.lab.actor, id, { limit: 50 })
    expect(again.messages.filter((m) => m.body === AUTO_WARNING)).toHaveLength(1)

    await service.runAutoCloseSweep(new Date(now.getTime() + DAY))
    const closed = await row(id)
    expect(closed).toMatchObject({ status: 'closed', closeReason: 'no_reply', closedBy: null, autoCloseWarnedAt: null })
    const events = await db.select().from(supEvents).where(eq(supEvents.ticketId, id))
    expect(events.map((e) => e.type)).toContain('auto_closed')
    // The lab can still reopen and rate it
    expect((await queries.getTicketDetail(callers.lab.actor, id))?.canRate).toBe(true)
  })

  it('cancels the auto-close when the lab replies after the warning', async () => {
    const start = new Date(Date.now() - 8 * DAY)
    const id = await open(callers.member, 'Replies in time', start)
    await say(callers.agent, id, new Date(start.getTime() + HOUR))
    const warnedAt = new Date(start.getTime() + HOUR + 6 * DAY)
    await service.runAutoCloseSweep(warnedAt)
    expect((await queries.getTicketDetail(callers.lab.actor, id))?.autoCloseAt).toBeTruthy()
    await say(callers.lab, id, new Date(warnedAt.getTime() + HOUR))
    await service.runAutoCloseSweep(new Date(warnedAt.getTime() + 2 * DAY))
    expect(await row(id)).toMatchObject({ status: 'live', autoCloseWarnedAt: null })
  })

  it('takes one rating from the lab on a closed conversation', async () => {
    const id = await open(callers.member, 'Rate me', new Date())
    await say(callers.agent, id, new Date())
    await expect(service.rateTicket(callers.member, id, { score: 5 })).rejects.toMatchObject({ status: 403 }) // still open
    await service.applyTicketAction(callers.agent, id, { action: 'close', reason: 'resolved' })

    await expect(service.rateTicket(callers.agent, id, { score: 5 })).rejects.toMatchObject({ status: 403 })
    await expect(service.rateTicket(callers.other, id, { score: 1 })).rejects.toMatchObject({ status: 404 })
    await service.rateTicket(callers.member, id, { score: 4, comment: '  Quick and clear  ' })
    await expect(service.rateTicket(callers.lab, id, { score: 1 })).rejects.toMatchObject({ status: 409 })

    const agentView = await queries.getTicketDetail(callers.agent.actor, id)
    expect(agentView?.rating).toMatchObject({ score: 4, comment: 'Quick and clear' })
    expect((await queries.getTicketDetail(callers.lab.actor, id))?.canRate).toBe(false)
    expect(notify.notifyRated).toHaveBeenCalled()
  })

  it('emails unread replies to people who are away, at most every 10 minutes, never what they have read', async () => {
    const now = new Date()
    const id = await open(callers.member, 'Digest <b>please</b>', new Date(now.getTime() - 20 * 60_000))
    await service.applyTicketAction(callers.agent, id, { action: 'claim' }, new Date(now.getTime() - 19 * 60_000))
    await say(callers.agent, id, new Date(now.getTime() - 5 * 60_000))
    vi.mocked(jobs.queueEmail).mockClear()

    // The agent's reply is unread by both lab people. The assignee replied after the lab's message, so has read it
    await digest.sendEmailDigests(now)
    expect(emailsTo('lab', 'Digest')).toHaveLength(1)
    expect(emailsTo('member', 'Digest')).toHaveLength(1)
    expect(emailsTo('agent', 'Digest')).toHaveLength(0)
    const html = emailsTo('lab', 'Digest')[0].html
    expect(html).toContain('Digest &lt;b&gt;please&lt;/b&gt;')
    expect(html).not.toContain('<b>please</b>')
    expect(emailsTo('lab', 'Digest')[0].subject).toMatch(/^New reply in SUP-\d+/)

    // Same messages again, or within 10 minutes: nothing
    await digest.sendEmailDigests(new Date(now.getTime() + 60_000))
    expect(emailsTo('lab', 'Digest')).toHaveLength(1)

    // A newer reply: the member already read it, the owner has the app open, so neither is emailed
    const newer = await say(callers.agent, id, new Date(now.getTime() + 60_000))
    await service.markRead(callers.member, id, newer.message.seq)
    await realtime.openStream(callers.lab.actor.id, 'test-conn', false)
    try {
      await digest.sendEmailDigests(new Date(now.getTime() + 12 * 60_000))
      expect(emailsTo('member', 'Digest')).toHaveLength(1)
      expect(emailsTo('lab', 'Digest')).toHaveLength(1)
    } finally {
      await realtime.closeStream(callers.lab.actor.id, 'test-conn')
    }
    // Away again: now the owner gets it
    await digest.sendEmailDigests(new Date(now.getTime() + 13 * 60_000))
    expect(emailsTo('lab', 'Digest')).toHaveLength(2)
  })

  it('respects the "conversation updates" email switch', async () => {
    await setPreference(callers.member.actor.id, 'supportTicketUpdatedEmail', false)
    const now = new Date()
    const id = await open(callers.member, 'Muted', new Date(now.getTime() - 10 * 60_000))
    await say(callers.agent, id, new Date(now.getTime() - 5 * 60_000))
    vi.mocked(jobs.queueEmail).mockClear()
    await digest.sendEmailDigests(now)
    expect(emailsTo('member', 'Muted')).toHaveLength(0)
    expect(emailsTo('lab', 'Muted')).toHaveLength(1)
  })

  it('delivers job notifications (no acting person) to the right people, in-app', async () => {
    // The real notify module: the dispatcher silently drops payloads without an actor id
    const real = await vi.importActual<typeof import('@/src/lib/support/notify')>('@/src/lib/support/notify')
    const id = await open(callers.member, 'Real notify', new Date())
    const ticket = { id, number: 'SUP-TEST', subject: 'Real notify', clientId: callers.lab.actor.id, createdBy: callers.member.actor.id, assigneeId: callers.agent.actor.id }
    await real.notifySlaAlert(ticket, 2, new Date())
    await real.notifyAutoCloseWarning(ticket)
    await real.notifyAutoClosed(ticket)
    const rows = await db.execute(sql`select user_id, type from notifications where metadata->>'ticketId' = ${id} order by type`)
    const got = (rows as unknown as Array<{ user_id: string; type: string }>).map((r) => `${r.type}:${r.user_id}`)
    expect(got).toEqual(
      expect.arrayContaining([
        `support_sla_alert:${callers.agent.actor.id}`,
        `support_ticket_updated:${callers.lab.actor.id}`,
        `support_ticket_updated:${callers.member.actor.id}`,
        `support_ticket_closed:${callers.lab.actor.id}`,
        `support_ticket_closed:${callers.member.actor.id}`,
      ]),
    )
    expect(got).toHaveLength(5)
  })

  it('gives agents team metrics; labs are refused', async () => {
    const metrics = await tools.supportMetrics(callers.agent.actor, 30)
    expect(metrics.created).toBeGreaterThanOrEqual(8)
    expect(metrics.rating.count).toBeGreaterThanOrEqual(1)
    expect(metrics.autoClosed).toBeGreaterThanOrEqual(1)
    expect(metrics.firstResponseMeasured).toBeGreaterThanOrEqual(metrics.firstResponseOnTime)
    await expect(tools.supportMetrics(callers.lab.actor, 30)).rejects.toMatchObject({ status: 403 })
    void supMessages
  })
})
