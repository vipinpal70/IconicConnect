/**
 * The bell and the sidebar dots, live: real Postgres and Redis, real routes. Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… REDIS_URL=redis://localhost:6380 npx vitest run live-badges
 *
 * Email is faked. Creates throwaway people and records and removes them. Never point this at production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: '', role: '', clientId: null as string | null }))
vi.mock('@/src/lib/auth/server', () => ({
  getCurrentSession: async () => ({ ...session }),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: session.userId } }, error: null }) } }),
}))
vi.mock('@/src/lib/queue/jobs', () => ({ queueEmail: vi.fn(async () => ({})) }))
vi.mock('@/src/lib/queue/client', () => ({ chatQueue: { add: vi.fn() }, caseCleanupQueue: { addBulk: vi.fn() }, emailQueue: { add: vi.fn() }, connection: { status: 'ready' } }))
// These would notify every real lab or admin in the local database
vi.mock('@/src/lib/notifications/notification-dispatcher', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  notifyTutorialCreated: vi.fn(async () => {}),
  notifyOfferCreated: vi.fn(async () => {}),
}))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('live bell and dots (database + Redis)', async () => {
  const { NextRequest } = await import('next/server')
  const { db } = await import('@/src/db')
  const { eq, inArray, sql } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { cases } = await import('@/src/db/schema/case')
  const { notifications } = await import('@/src/db/schema/notification')
  const { offers } = await import('@/src/db/schema/offer')
  const { tutorials } = await import('@/src/db/schema/tutorial')
  const { supTickets } = await import('@/src/db/schema/support')
  const { listen } = await import('@/src/lib/live/bus')
  const { channelsFor } = await import('@/src/lib/live/channels')
  const { NotificationService } = await import('@/src/lib/notifications/notification-service')
  const { redis } = await import('@/src/lib/redis')
  const publish = await import('@/src/lib/live/publish')
  const badgesRoute = await import('@/src/app/api/sidebar-badges/route')
  const notifRoute = await import('@/src/app/api/notifications/[id]/route')
  const readAllRoute = await import('@/src/app/api/notifications/read-all/route')
  const caseRoute = await import('@/src/app/api/cases/[id]/route')
  const tutorialsRoute = await import('@/src/app/api/tutorials/route')
  const offersRoute = await import('@/src/app/api/offers/route')
  const support = await import('@/src/lib/support/service')
  const { TUTORIAL_CATEGORIES } = await import('@/src/lib/tutorials')
  const { OFFER_CATEGORIES } = await import('@/src/lib/offers')
  const cleanup = await import('@/src/lib/queue/case-cleanup')

  type Heard = { type: string; [k: string]: unknown }
  const u: Record<string, { id: string; role: string; clientId: string | null }> = {}
  const heard: Record<string, Heard[]> = {}
  const stops: Array<() => void> = []
  let caseId = ''
  const tag = crypto.randomUUID().slice(0, 8)

  async function make(key: string, role: string, parent?: string) {
    const id = crypto.randomUUID()
    const staff = !['client', 'subuser'].includes(role)
    const clientId = role === 'client' ? id : parent ?? null
    u[key] = { id, role, clientId }
    await db.insert(users).values({ id, email: `support-test-${id}@example.invalid`, passwordHash: 'x' })
    await db.insert(profiles).values({ id, userType: staff ? 'admin_portal' : 'lab_portal', role: role as never, status: 'active', fullName: `Live ${key}`, clientId, createdBy: parent ?? null, labName: role === 'client' ? `Live Lab ${key} ${tag}` : null })
    heard[key] = []
    const l = listen(channelsFor({ userId: id, role, clientId }).map((c) => c.channel), (e) => heard[key].push(e as Heard))
    stops.push(l.stop)
    await l.ready
  }
  const as = (key: string) => { session.userId = u[key].id; session.role = u[key].role; session.clientId = u[key].clientId }
  const req = (body: unknown, method = 'PATCH') => new NextRequest('http://localhost/api', { method, body: JSON.stringify(body) })
  const badges = async (key: string) => { as(key); return (await badgesRoute.GET()).json() as Promise<Record<string, boolean>> }
  const bell = (key: string) => heard[key].filter((e) => e.type === 'notification')
  const dots = (key: string) => heard[key].filter((e) => e.type === 'badge')
  const settle = () => new Promise((r) => setTimeout(r, 150))
  const ring = (keys: string[], extra: Record<string, unknown> = {}) =>
    NotificationService.dispatchMany(keys.map((k) => ({ type: 'case_assigned', actorUserId: u.admin.id, targetUserId: u[k].id, title: 'Secret title', message: 'Secret text', ...extra })))
  const mine = (key: string) => db.select().from(notifications).where(eq(notifications.userId, u[key].id))

  beforeAll(async () => {
    await make('admin', 'admin')
    await make('designer', 'designer')
    await make('lab', 'client')
    await make('member', 'subuser', u.lab.id)
    await make('other', 'client')
    const [c] = await db.insert(cases).values({ caseNumber: `LIVE-${tag}`, clientId: u.lab.id, designerId: u.designer.id, category: 'test', status: 'submitted_to_client' } as never).returning({ id: cases.id })
    caseId = c.id
  })
  beforeEach(async () => {
    await settle()
    Object.values(heard).forEach((l) => (l.length = 0))
  })
  afterAll(async () => {
    stops.forEach((s) => s())
    const ids = Object.values(u).map((x) => x.id)
    await db.execute(sql`delete from notifications where metadata->>'caseId' = ${caseId}`)
    await db.delete(supTickets).where(inArray(supTickets.clientId, ids))
    await db.delete(offers).where(inArray(offers.createdBy, ids))
    await db.delete(tutorials).where(inArray(tutorials.createdBy, ids))
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.delete(cases).where(eq(cases.id, caseId))
    await db.delete(users).where(inArray(users.id, ids))
    for (const id of ids) await redis.del(`ver:live:live:user:${id}`, `ver:live:live:lab:${id}`, `sidebar-badges:${id}`)
  })

  describe('the bell', () => {
    it('a new notification reaches exactly its recipients, at once, without its text', async () => {
      const start = Date.now()
      await ring(['designer', 'lab'])
      await vi.waitFor(() => expect([bell('designer').length, bell('lab').length]).toEqual([1, 1]))
      expect(Date.now() - start).toBeLessThan(1000)
      await settle()
      expect(bell('designer')).toEqual([{ type: 'notification', unread: true }])
      expect([bell('member'), bell('other'), bell('admin')]).toEqual([[], [], []])
      expect(JSON.stringify(heard)).not.toMatch(/Secret/)
    })

    it('says whether anything is still unread when one is read or dismissed, and when all are', async () => {
      await ring(['designer'])
      const unread = (await mine('designer')).filter((n) => !n.read)
      expect(unread.length).toBeGreaterThanOrEqual(2)
      as('designer')
      const states: unknown[] = []
      for (const n of unread) {
        heard.designer.length = 0
        await notifRoute.PATCH(req({ read: true }), { params: Promise.resolve({ id: n.id }) })
        await vi.waitFor(() => expect(bell('designer')).toHaveLength(1))
        states.push(bell('designer')[0].unread)
      }
      expect(states).toEqual([...Array(unread.length - 1).fill(true), false])

      await ring(['designer'])
      await settle()
      heard.designer.length = 0
      await readAllRoute.PATCH(req({}))
      await vi.waitFor(() => expect(bell('designer')).toEqual([{ type: 'notification', unread: false }]))
    })

    it('someone else\'s notification cannot be changed, and nobody is told', async () => {
      await ring(['other'])
      const [n] = await mine('other')
      await settle()
      heard.other.length = 0
      as('designer')
      expect((await notifRoute.PATCH(req({ read: true }), { params: Promise.resolve({ id: n.id }) })).status).toBe(404)
      await settle()
      expect([bell('other'), bell('designer')]).toEqual([[], []])
    })

    it('notifications removed with a case update the bell', async () => {
      await ring(['member'], { link: `/cases/${caseId}`, metadata: { caseId } })
      await settle()
      heard.member.length = 0
      await cleanup.processCaseCleanup({ caseId, caseNumber: null, keys: [] }, { deleteKeys: async (k) => k.length })
      await vi.waitFor(() => expect(bell('member')).toEqual([{ type: 'notification', unread: false }]))
    })
  })

  describe('the dots', () => {
    it('a new tutorial and a new offer light them for every lab, and for no staff', async () => {
      as('admin')
      const t = await tutorialsRoute.POST(req({ title: `T ${tag}`, category: TUTORIAL_CATEGORIES[0], description: 'd', youtubeVideoId: 'dQw4w9WgXcQ' }, 'POST') as never)
      expect([200, 201]).toContain(t!.status)
      await vi.waitFor(() => expect(dots('lab')).toContainEqual({ type: 'badge', key: 'tutorials', on: true }))
      const o = await offersRoute.POST(req({ title: `O ${tag}`, brand: 'B', category: OFFER_CATEGORIES[0], description: 'd', discount: '10%', startDate: '2026-01-01', validTill: '2099-01-01', active: true, sponsored: false, targetClients: [], targetLocations: [] }, 'POST') as never)
      expect([200, 201]).toContain(o!.status)
      await vi.waitFor(() => expect(dots('other')).toContainEqual({ type: 'badge', key: 'offers', on: true }))
      expect(dots('member')).toHaveLength(2)
      expect([dots('admin'), dots('designer')]).toEqual([[], []])
    })

    it('a change to a case tells that lab to look again, and no other lab', async () => {
      as('lab')
      const res = await caseRoute.PUT(req({ status: 'change_requested', clientMassage: 'thinner' }, 'PUT'), { params: Promise.resolve({ id: caseId }) })
      expect(res.status).toBe(200)
      await vi.waitFor(() => expect(dots('member')).toContainEqual({ type: 'badge' }))
      await settle()
      expect([dots('other'), dots('designer')]).toEqual([[], []])
    })

    it('opening a page turns its dot off on the person\'s other devices only', async () => {
      as('lab')
      await badgesRoute.PATCH(req({ page: 'offers' }))
      await vi.waitFor(() => expect(dots('lab')).toEqual([{ type: 'badge', key: 'offers', on: false }]))
      await settle()
      expect(dots('member')).toEqual([])
    })

    it('staff and one-lab dots stay within their audience', async () => {
      await publish.lightStaffBadge('cases')
      await publish.lightLabBadge(u.lab.id, 'billing')
      await settle()
      expect(dots('admin')).toEqual([{ type: 'badge', key: 'cases', on: true }])
      expect(dots('designer')).toEqual([{ type: 'badge', key: 'cases', on: true }])
      expect(dots('lab')).toEqual([{ type: 'badge', key: 'billing', on: true }])
      expect(dots('member')).toEqual([{ type: 'badge', key: 'billing', on: true }])
      expect(dots('other')).toEqual([])
    })
  })

  describe('the cached answer', () => {
    it('is used while nothing changes, and never outlives a change', async () => {
      await db.update(notifications).set({ read: true }).where(eq(notifications.userId, u.designer.id))
      await redis.del(`sidebar-badges:${u.designer.id}`)
      expect((await badges('designer')).notifications).toBe(false)

      // Behind the cache's back: still the cached answer, so it really is used
      await db.insert(notifications).values({ userId: u.designer.id, type: 'x', title: 't', message: 'm' })
      expect((await badges('designer')).notifications).toBe(false)
      // Any event for this person makes the next answer fresh, even if the cached copy was never deleted
      await publish.publishLive(`live:user:${u.designer.id}`, { type: 'notification' })
      expect((await badges('designer')).notifications).toBe(true)
    })

    it('a shared event (all labs) refreshes every lab\'s answer', async () => {
      as('other')
      await badgesRoute.PATCH(req({ page: 'tutorials' }))
      expect((await badges('other')).tutorials).toBe(false)
      as('admin')
      await tutorialsRoute.POST(req({ title: `T2 ${tag}`, category: TUTORIAL_CATEGORIES[0], description: 'd', youtubeVideoId: 'dQw4w9WgXcQ' }, 'POST') as never)
      expect((await badges('other')).tutorials).toBe(true)
    })

    it('the Support dot is always current, and designers have none', async () => {
      await badges('lab')
      expect((await badges('lab')).support).toBe(false)
      const caller = (key: string) => ({ actor: { ...u[key] }, profile: { id: u[key].id, userType: 'admin_portal' as const, role: u[key].role as never, fullName: key, labName: null, clientId: u[key].clientId } })
      await support.createTicket(caller('admin'), { subject: 'Hi', category: 'technical', message: 'm', clientId: u.lab.id, clientMsgId: crypto.randomUUID() })
      expect((await badges('lab')).support).toBe(true)
      expect((await badges('other')).support).toBe(false)
      expect('support' in (await badges('designer'))).toBe(false)
    })
  })
})
