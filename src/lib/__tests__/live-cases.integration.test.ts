/**
 * Case lists and case pages, live: real Postgres and Redis, real routes. Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… REDIS_URL=redis://localhost:6380 npx vitest run live-cases
 *
 * Email is faked. Creates throwaway people and cases and removes them. Never point this at production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: '', role: '', clientId: null as string | null }))
vi.mock('@/src/lib/auth/server', () => ({
  getCurrentSession: async () => ({ ...session }),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: session.userId } }, error: null }) } }),
}))
vi.mock('@/src/lib/auth/request-user', () => ({ getRequestUser: async () => ({ id: session.userId }) }))
vi.mock('@/src/lib/queue/jobs', () => ({ queueEmail: vi.fn(async () => ({})) }))
vi.mock('@/src/lib/queue/client', () => ({ chatQueue: { add: vi.fn() }, caseCleanupQueue: { addBulk: vi.fn() }, emailQueue: { add: vi.fn() }, connection: { status: 'ready' } }))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('live case lists (database + Redis)', async () => {
  const { NextRequest } = await import('next/server')
  const { db } = await import('@/src/db')
  const { eq, inArray, sql } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { cases } = await import('@/src/db/schema/case')
  const { listen } = await import('@/src/lib/live/bus')
  const { channelsFor } = await import('@/src/lib/live/channels')
  const { redis } = await import('@/src/lib/redis')
  const { invalidateCasesCache } = await import('@/src/lib/redis-cache')
  const { MAX_CASE_IDS } = await import('@/src/lib/live/publish')
  const listRoute = await import('@/src/app/api/cases/route')
  const caseRoute = await import('@/src/app/api/cases/[id]/route')
  const clientRoute = await import('@/src/app/api/admin/clients/[id]/route')
  const downloads = await import('@/src/lib/bulk-download/tracking')

  type Heard = { type: string; [k: string]: unknown }
  type Row = { id: string; status: string; internalFilesDownloadedAt?: string | null; createdById?: string; hasUnreadChat?: boolean }
  const u: Record<string, { id: string; role: string; clientId: string | null }> = {}
  const c: Record<string, string> = {}
  const heard: Record<string, Heard[]> = {}
  const stops: Array<() => void> = []
  const tag = crypto.randomUUID().slice(0, 8)

  async function make(key: string, role: string, parent?: string) {
    const id = crypto.randomUUID()
    const staff = !['client', 'subuser'].includes(role)
    const clientId = role === 'client' ? id : parent ?? null
    u[key] = { id, role, clientId }
    await db.insert(users).values({ id, email: `support-test-${id}@example.invalid`, passwordHash: 'x' })
    await db.insert(profiles).values({ id, userType: staff ? 'admin_portal' : 'lab_portal', role: role as never, status: 'active', fullName: `Live ${key}`, clientId, createdBy: parent ?? null, labName: role === 'client' ? `Live Lab ${key} ${tag}` : null })
    heard[key] = []
    const l = listen(channelsFor({ userId: id, role, clientId }).map((x) => x.channel), (e) => heard[key].push(e as Heard))
    stops.push(l.stop)
    await l.ready
  }
  async function makeCase(key: string, lab: string, status = 'in_progress') {
    const [row] = await db.insert(cases).values({ caseNumber: `LIVE-${tag}-${key}`, clientId: u[lab].id, designerId: u.designer.id, category: 'Crown', status } as never).returning({ id: cases.id })
    c[key] = row.id
  }
  const as = (key: string) => { session.userId = u[key].id; session.role = u[key].role; session.clientId = u[key].clientId }
  const params = (id: string) => ({ params: Promise.resolve({ id }) })
  const put = async (who: string, id: string, body: unknown) => {
    as(who)
    return (await caseRoute.PUT(new NextRequest('http://localhost/api', { method: 'PUT', body: JSON.stringify(body) }), params(id))).status
  }
  const get = async (who: string, query: string) => {
    as(who)
    const res = await listRoute.GET(new NextRequest(`http://localhost/api/cases?${query}`))
    return { status: res.status, body: (await res.json()) as { data: Row[]; matching?: string[]; hasMore?: boolean } }
  }
  const rows = async (who: string, ids: string[]) => (await get(who, `ids=${ids.join(',')}`)).body.data.map((r) => r.id).sort()
  const events = (key: string) => heard[key].filter((e) => e.type === 'case')
  const settle = () => new Promise((r) => setTimeout(r, 150))

  beforeAll(async () => {
    await make('admin', 'admin')
    await make('designer', 'designer')
    await make('lab', 'client')
    await make('member', 'subuser', u.lab.id)
    await make('other', 'client')
    await makeCase('a', 'lab', 'scan_received')
    await makeCase('b', 'lab', 'on_hold')
    await makeCase('x', 'other')
  })
  beforeEach(async () => {
    await settle()
    Object.values(heard).forEach((l) => (l.length = 0))
  })
  afterAll(async () => {
    stops.forEach((s) => s())
    const ids = Object.values(u).map((x) => x.id)
    const caseIds = Object.values(c)
    for (const id of caseIds) await db.execute(sql`delete from notifications where metadata->>'caseId' = ${id} or link like ${'%' + id + '%'}`)
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.delete(cases).where(inArray(cases.clientId, ids))
    await db.delete(users).where(inArray(users.id, ids))
    for (const id of ids) await redis.del(`ver:live:live:user:${id}`, `ver:live:live:lab:${id}`, `sidebar-badges:${id}`)
  })

  describe('asking for rows by id', () => {
    it('follows the same access rules as the list', async () => {
      const all = [c.a, c.b, c.x]
      expect(await rows('admin', all)).toEqual([...all].sort())
      expect(await rows('designer', all)).toEqual([...all].sort())
      expect(await rows('lab', all)).toEqual([c.a, c.b].sort())
      expect(await rows('member', all)).toEqual([c.a, c.b].sort())
      expect(await rows('other', all)).toEqual([c.x])
    })

    it('answers the same rows as the list, staff-only fields included or not', async () => {
      for (const who of ['admin', 'lab']) {
        const full = (await get(who, 'limit=100&page=1')).body.data.find((r) => r.id === c.a)
        const one = (await get(who, `ids=${c.a}`)).body.data[0]
        expect(one).toEqual(full)
        expect('matchesFilters' in one).toBe(false)
      }
    })

    it('takes 1 to 50 ids and nothing else', async () => {
      const many = Array.from({ length: MAX_CASE_IDS + 1 }, () => crypto.randomUUID())
      expect((await get('admin', `ids=${many.join(',')}`)).status).toBe(400)
      expect((await get('admin', `ids=${many.slice(1).join(',')}`)).status).toBe(200)
      expect((await get('admin', 'ids=')).status).toBe(400)
      expect((await get('admin', "ids=1' or 1=1")).status).toBe(400)
      // Repeats and upper case are the same id
      expect(await rows('admin', [c.a, c.a.toUpperCase()])).toEqual([c.a])
    })

    it('says which rows match the filters, and returns the others too', async () => {
      const q = `ids=${c.a},${c.b}&statuses=on_hold`
      const { body } = await get('lab', q)
      expect(body.data.map((r) => r.id).sort()).toEqual([c.a, c.b].sort())
      expect(body.matching).toEqual([c.b])
      expect((await get('lab', `ids=${c.a},${c.b}&search=LIVE-${tag}-a`)).body.matching).toEqual([c.a])
      expect((await get('designer', `ids=${c.a}&assignedTo=mine`)).body.matching).toEqual([c.a])
      expect((await get('admin', `ids=${c.a}&assignedTo=mine`)).body.matching).toEqual([])
      expect((await get('lab', `ids=${c.a},${c.b}`)).body.matching?.sort()).toEqual([c.a, c.b].sort())
    })

    it('filters never widen what a lab may see', async () => {
      expect((await get('lab', `ids=${c.x}&clientId=${u.other.id}`)).body).toMatchObject({ data: [], matching: [] })
    })
  })

  describe('the event', () => {
    it('a status change reaches staff and that lab, not another lab, and carries only the id', async () => {
      expect(await put('admin', c.a, { status: 'scan_verified' })).toBe(200)
      await vi.waitFor(() => expect(events('admin')).toHaveLength(1))
      await settle()
      for (const key of ['admin', 'designer', 'lab', 'member']) expect(events(key)).toEqual([{ type: 'case', ids: [c.a] }])
      expect(events('other')).toEqual([])
    })

    it('who asks on hearing it gets the new state: the list row and the case page', async () => {
      as('admin')
      await caseRoute.GET(new NextRequest('http://localhost/api'), params(c.a)) // cached now
      const seen: string[] = []
      const l = listen(channelsFor({ userId: u.admin.id, role: 'admin', clientId: null }).map((x) => x.channel), (e) => {
        if ((e as Heard).type !== 'case') return
        void (async () => {
          const cached = await redis.get(`case:detail:${c.a}`)
          const row = (await db.select().from(cases).where(eq(cases.id, c.a)))[0]
          seen.push(`${row.status} ${cached === null}`)
        })()
      })
      await l.ready
      expect(await put('admin', c.a, { status: 'on_hold', holdReason: 'test' })).toBe(200)
      await vi.waitFor(() => expect(seen).toEqual(['on_hold true']))
      l.stop()
      expect((await get('lab', `ids=${c.a}`)).body.data[0].status).toBe('on_hold')
      as('admin')
      const res = await caseRoute.GET(new NextRequest('http://localhost/api'), params(c.a))
      expect((await res.json()).data.status).toBe('on_hold')
    })

    it('a refused change sends nothing', async () => {
      expect(await put('other', c.a, { status: 'cancelled' })).not.toBe(200)
      await settle()
      expect(events('admin')).toEqual([])
    })

    it('what staff downloaded is for staff only; what the lab downloaded is for both', async () => {
      const done = (scope: 'internal_files' | 'client_output') => downloads.resetCaseDownloads(c.a, scope, { id: u.admin.id, role: 'admin' } as never)
      await done('internal_files')
      await vi.waitFor(() => expect(events('designer')).toHaveLength(1))
      await settle()
      expect([events('lab'), heard.lab]).toEqual([[], []])
      await done('client_output')
      await vi.waitFor(() => expect(events('lab')).toEqual([{ type: 'case', ids: [c.a] }]))
    })

    it('too many cases at once: "reload" instead of a list of ids', async () => {
      await invalidateCasesCache(u.lab.id, Array.from({ length: MAX_CASE_IDS + 1 }, () => crypto.randomUUID()))
      await vi.waitFor(() => expect(events('lab')).toEqual([{ type: 'case', ids: null }]))
      Object.values(heard).forEach((l) => (l.length = 0))
      await invalidateCasesCache(u.lab.id)
      await vi.waitFor(() => expect(events('lab')).toEqual([{ type: 'case', ids: null }]))
    })

    it('events are counted, so a browser that missed one knows', async () => {
      const before = Number(await redis.get(`ver:live:live:lab:${u.lab.id}`))
      await invalidateCasesCache(u.lab.id, c.a)
      expect(Number(await redis.get(`ver:live:live:lab:${u.lab.id}`))).toBeGreaterThan(before)
    })

    it('a deleted case: everyone hears, and asking for it returns nothing', async () => {
      await makeCase('d', 'lab', 'scan_received')
      as('admin')
      expect((await caseRoute.DELETE(new NextRequest('http://localhost/api', { method: 'DELETE' }), params(c.d))).status).toBe(200)
      await vi.waitFor(() => expect(events('lab')).toEqual([{ type: 'case', ids: [c.d] }]))
      expect(events('designer')).toHaveLength(1)
      expect(await rows('lab', [c.a, c.d])).toEqual([c.a])
    })

    it('a deleted lab: its cases leave the staff lists at once, the cached ones too', async () => {
      await make('gone', 'client')
      await makeCase('g', 'gone')
      await invalidateCasesCache(u.gone.id, c.g)
      const loaded = async () => (await get('admin', 'limit=100&page=1')).body.data.some((r) => r.id === c.g)
      expect(await loaded()).toBe(true)
      await settle()
      heard.designer.length = 0
      as('admin')
      const res = (await clientRoute.DELETE(new Request('http://localhost/api', { method: 'DELETE' }), params(u.gone.id)))!
      expect(res.status).toBe(200)
      await vi.waitFor(() => expect(events('designer')).toEqual([{ type: 'case', ids: [c.g] }]))
      expect(await loaded()).toBe(false)
    })
  })
})
