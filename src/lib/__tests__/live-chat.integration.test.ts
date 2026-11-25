/**
 * Case chat, live: who hears about what, through the real routes, Postgres and Redis. Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… REDIS_URL=redis://localhost:6380 npx vitest run live-chat
 *
 * Email and the job queue are faked. Never point this at production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: '' }))
vi.mock('@/src/lib/auth/server', () => ({
  getCurrentSession: async () => ({ ...session }),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: session.userId } }, error: null }) } }),
}))
vi.mock('@/src/lib/queue/jobs', () => ({ queueEmail: vi.fn(async () => ({})) }))
vi.mock('@/src/lib/queue/client', () => ({ chatQueue: { add: vi.fn() }, caseCleanupQueue: { addBulk: vi.fn() }, connection: { status: 'ready' } }))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('live case chat (database + Redis)', async () => {
  const { NextRequest } = await import('next/server')
  const { db } = await import('@/src/db')
  const { eq, inArray, sql } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { cases } = await import('@/src/db/schema/case')
  const { listen } = await import('@/src/lib/live/bus')
  const { channelsFor } = await import('@/src/lib/live/channels')
  const { redis } = await import('@/src/lib/redis')
  const thread = await import('@/src/app/api/cases/[id]/chat/route')
  const single = await import('@/src/app/api/cases/[id]/chat/[messageId]/route')
  const readRoute = await import('@/src/app/api/cases/[id]/chat/read/route')
  const caseRoute = await import('@/src/app/api/cases/[id]/route')

  type Heard = { type: string; [k: string]: unknown }
  const u: Record<string, string> = {}
  const heard: Record<string, Heard[]> = {}
  const stops: Array<() => void> = []
  const ON_CASE = ['lab', 'member', 'designer', 'manager', 'admin']
  const NOT = ['qcElsewhere', 'designerElsewhere', 'otherLab', 'otherMember']
  let caseId = ''
  const tag = crypto.randomUUID().slice(0, 8)

  async function make(key: string, role: string, parent?: string) {
    const id = crypto.randomUUID()
    const staff = !['client', 'subuser'].includes(role)
    const clientId = role === 'client' ? id : parent ?? null
    u[key] = id
    await db.insert(users).values({ id, email: `support-test-${id}@example.invalid`, passwordHash: 'x' })
    await db.insert(profiles).values({ id, userType: staff ? 'admin_portal' : 'lab_portal', role: role as never, status: 'active', fullName: `Chat ${key}`, clientId, createdBy: parent ?? null, labName: role === 'client' ? `Live Chat Lab ${key} ${tag}` : null })
    heard[key] = []
    const l = listen(channelsFor({ userId: id, role, clientId }).map((c) => c.channel), (e) => heard[key].push(e as Heard))
    stops.push(l.stop)
    await l.ready
  }
  const params = { params: Promise.resolve({ id: '' }) }
  const at = (messageId?: string) => ({ params: Promise.resolve({ id: caseId, messageId: messageId! }) })
  const req = (body: unknown, method: string) => new NextRequest('http://localhost/api', { method, body: JSON.stringify(body) })
  const of = (key: string, type: string) => heard[key].filter((e) => e.type === type)
  const settle = () => new Promise((r) => setTimeout(r, 200))
  const reset = async () => { await settle(); Object.values(heard).forEach((l) => (l.length = 0)) }
  async function send(key: string, text: string): Promise<string> {
    session.userId = u[key]
    const res = await thread.POST(req({ messageText: text }, 'POST'), at())
    expect(res.status).toBe(200)
    return (await res.json()).data.id
  }
  async function seen(key: string, messageId: string) {
    session.userId = u[key]
    return readRoute.POST(req({ messageId }, 'POST'), at())
  }
  void params

  beforeAll(async () => {
    await make('lab', 'client')
    await make('member', 'subuser', u.lab) // of the lab, not the case's own sub-user
    await make('designer', 'designer')
    await make('manager', 'account_manager')
    await make('admin', 'admin')
    await make('qcElsewhere', 'qc')
    await make('designerElsewhere', 'designer')
    await make('otherLab', 'client')
    await make('otherMember', 'subuser', u.otherLab)
    const [c] = await db.insert(cases).values({ caseNumber: `LIVECHAT-${tag}`, clientId: u.lab, designerId: u.designer, accountManagerId: u.manager, category: 'test', status: 'in_progress' } as never).returning({ id: cases.id })
    caseId = c.id
  })
  beforeEach(reset)
  afterAll(async () => {
    stops.forEach((s) => s())
    const ids = Object.values(u)
    await db.execute(sql`delete from notifications where metadata->>'caseId' = ${caseId}`)
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.delete(cases).where(eq(cases.id, caseId))
    await db.delete(users).where(inArray(users.id, ids))
    for (const id of ids) await redis.del(`ver:live:live:user:${id}`, `ver:live:live:lab:${id}`)
  })

  it('a message reaches everyone who may open the chat, at once, and nobody else', async () => {
    const start = Date.now()
    await send('designer', 'Secret text one')
    await vi.waitFor(() => ON_CASE.forEach((k) => expect(of(k, 'chat'), k).toEqual([{ type: 'chat', caseId, kind: 'new' }])))
    expect(Date.now() - start).toBeLessThan(1500)
    await settle()
    NOT.forEach((k) => expect(heard[k], k).toEqual([]))
    expect(JSON.stringify(heard)).not.toMatch(/Secret/)
  })

  it('so do edits and deletes, marked as changes', async () => {
    const id = await send('lab', 'Secret original')
    await reset()
    session.userId = u.lab
    expect((await single.PATCH(req({ messageText: 'Secret edited' }, 'PATCH'), at(id))).status).toBe(200)
    await vi.waitFor(() => ON_CASE.forEach((k) => expect(of(k, 'chat'), k).toEqual([{ type: 'chat', caseId, kind: 'changed' }])))
    await reset()
    expect((await single.DELETE(new NextRequest('http://localhost/api', { method: 'DELETE' }), at(id))).status).toBe(204)
    await vi.waitFor(() => ON_CASE.forEach((k) => expect(of(k, 'chat'), k).toEqual([{ type: 'chat', caseId, kind: 'changed' }])))
    await settle()
    NOT.forEach((k) => expect(heard[k], k).toEqual([]))
    expect(JSON.stringify(heard)).not.toMatch(/Secret/)
  })

  it('a refused change is announced to nobody', async () => {
    const id = await send('lab', 'mine')
    await reset()
    session.userId = u.designer
    expect((await single.PATCH(req({ messageText: 'x' }, 'PATCH'), at(id))).status).toBe(403)
    session.userId = u.otherLab
    expect((await thread.POST(req({ messageText: 'x' }, 'POST'), at())).status).toBe(403)
    expect((await seen('otherLab', id)).status).toBe(403)
    await settle()
    Object.keys(heard).forEach((k) => expect(heard[k], k).toEqual([]))
  })

  it('the sender\'s own lists end without a badge: the message first, then their read position', async () => {
    await send('designer', 'x')
    await vi.waitFor(() => expect(of('designer', 'chat-read')).toHaveLength(1))
    const order = heard.designer.map((e) => e.type).filter((t) => t.startsWith('chat'))
    expect(order).toEqual(['chat', 'chat-read'])
    ON_CASE.filter((k) => k !== 'designer').forEach((k) => expect(of(k, 'chat-read'), k).toEqual([]))
  })

  it('reading tells only the reader\'s own devices, and only when it was new to them', async () => {
    const id = await send('lab', 'x')
    await reset()
    expect((await seen('designer', id)).status).toBe(200)
    await vi.waitFor(() => expect(of('designer', 'chat-read')).toEqual([{ type: 'chat-read', caseId }]))
    await seen('designer', id)
    await settle()
    expect(of('designer', 'chat-read')).toHaveLength(1)
    ;[...ON_CASE, ...NOT].filter((k) => k !== 'designer').forEach((k) => expect(of(k, 'chat-read'), k).toEqual([]))
  })

  it('rejecting a case puts its line in open chats too', async () => {
    await db.update(cases).set({ status: 'submitted_to_client' as never }).where(eq(cases.id, caseId))
    session.userId = u.lab
    const res = await caseRoute.PUT(req({ status: 'client_reject', clientMassage: 'wrong tooth' }, 'PUT'), { params: Promise.resolve({ id: caseId }) })
    expect(res.status).toBe(200)
    await vi.waitFor(() => ON_CASE.forEach((k) => expect(of(k, 'chat'), k).toEqual([{ type: 'chat', caseId, kind: 'new' }])))
    await settle()
    NOT.forEach((k) => expect(of(k, 'chat'), k).toEqual([]))
  })

  it('someone taken off the case stops hearing it', async () => {
    await db.update(cases).set({ status: 'in_progress' as never, designerId: u.designerElsewhere }).where(eq(cases.id, caseId))
    await send('lab', 'x')
    await vi.waitFor(() => expect(of('designerElsewhere', 'chat')).toHaveLength(1))
    await settle()
    expect(of('designer', 'chat')).toEqual([])
  })
})
