/**
 * The live connection through its real routes and real Redis. Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… REDIS_URL=redis://localhost:6380 npx vitest run live.integration
 *
 * Never point this at production.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const current = vi.hoisted(() => ({ sid: undefined as string | undefined }))
vi.mock('@/src/lib/auth/server', async () => {
  const { getSession } = await import('@/src/lib/auth/session')
  return { getCurrentSession: () => getSession(current.sid) }
})

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('live connection (Redis)', async () => {
  const { NextRequest } = await import('next/server')
  const { redis } = await import('@/src/lib/redis')
  const sessions = await import('@/src/lib/auth/session')
  const live = await import('@/src/app/api/live/route')
  const presenceRoute = await import('@/src/app/api/live/presence/route')
  const support = await import('@/src/lib/support/realtime')
  const { channelsFor, openStreamCount } = await import('@/src/lib/live/stream')
  const presence = await import('@/src/lib/live/presence')
  const publish = await import('@/src/lib/live/publish')

  const uuid = () => crypto.randomUUID()
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const people: string[] = []
  const open: Array<{ stop: () => void }> = []
  const labA = uuid(), labB = uuid()

  async function login(role: string, clientId: string | null = null, userId = uuid()) {
    people.push(userId)
    const { sid } = await sessions.createSession({ userId, email: `${userId}@example.invalid`, role, userType: clientId ? 'lab_portal' : 'admin_portal', clientId, status: 'active' })
    return { userId, sid }
  }

  interface Frame { type: string; data: Record<string, unknown> }
  async function connect(sid: string | undefined) {
    current.sid = sid
    const abort = new AbortController()
    const req = new NextRequest('http://localhost/api/live', { signal: abort.signal, headers: sid ? { cookie: `${sessions.SESSION_COOKIE}=${sid}` } : {} })
    const res = await live.GET(req)
    const frames: Frame[] = []
    const state = { res, frames, ended: false, stop: () => abort.abort(), of: (type: string) => frames.filter((f) => f.type === type) }
    open.push(state)
    if (res.status === 200 && res.body) {
      void (async () => {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop()!
          for (const part of parts) {
            const type = /^event: (.*)$/m.exec(part)?.[1]
            const data = /^data: (.*)$/m.exec(part)?.[1]
            if (type) frames.push({ type, data: JSON.parse(data ?? '{}') })
          }
        }
        state.ended = true
      })()
      await vi.waitFor(() => expect(state.of('hello').length).toBe(1), 5000)
    }
    return state
  }

  afterEach(() => {
    open.splice(0).forEach((s) => s.stop())
  })
  afterAll(async () => {
    for (const id of people) {
      await sessions.destroyAllSessions(id)
      await redis.del(`sup:streams:${id}`, `live:present:${id}`)
      await redis.zrem('sup:agents:online', id)
    }
    for (const lab of [labA, labB]) await redis.del(`ver:live:sup:lab:${lab}`)
  })

  it('needs a session; LIVE_UPDATES=off answers 204 so browsers stop reconnecting', async () => {
    expect((await connect(undefined)).res.status).toBe(401)
    expect((await connect('made-up')).res.status).toBe(401)
    const { sid } = await login('client', labA)
    process.env.LIVE_UPDATES = 'off'
    try {
      expect((await connect(sid)).res.status).toBe(204)
    } finally {
      delete process.env.LIVE_UPDATES
    }
  })

  it('every role is connected, each to its own channels only', () => {
    const of = (role: string, clientId: string | null = null) => channelsFor({ userId: 'u', role, clientId }).channels
    expect(of('client', 'A')).toEqual(['live:user:u', 'live:lab:A', 'live:labs', 'sup:lab:A'])
    expect(of('subuser', 'A')).toEqual(of('client', 'A'))
    for (const role of ['admin', 'qc', 'account_manager']) expect(of(role)).toEqual(['live:user:u', 'live:staff', 'sup:agents'])
    expect(of('designer')).toEqual(['live:user:u', 'live:staff']) // no support (D10)
    expect(of('client', null)).toEqual(['live:user:u'])
    expect(of('somebody-new')).toEqual(['live:user:u']) // a role nobody decided about hears nothing shared
  })

  it('a lab hears its own events, never another lab\'s or internal ones; designers hear no support', async () => {
    const a = await connect((await login('client', labA)).sid)
    const member = await connect((await login('subuser', labA)).sid)
    const b = await connect((await login('client', labB)).sid)
    const agent = await connect((await login('qc')).sid)
    const designer = await connect((await login('designer')).sid)

    const t1 = uuid(), t2 = uuid()
    await support.publishToBoth(labA, { type: 'message', ticketId: t1, seq: 7 })
    await support.publishToAgents({ type: 'message', ticketId: t2, seq: 8 }) // an internal note
    await vi.waitFor(() => expect(agent.of('message').map((f) => f.data.ticketId)).toEqual([t1, t2]))
    await wait(200)
    expect(a.of('message').map((f) => f.data.ticketId)).toEqual([t1])
    expect(member.of('message').map((f) => f.data.ticketId)).toEqual([t1])
    expect(b.of('message')).toEqual([])
    expect(designer.of('message')).toEqual([])
    expect(JSON.stringify([a.frames, agent.frames])).not.toMatch(/body|text|subject/)
  })

  it('counts events, so a browser knows what it missed while away', async () => {
    const { sid } = await login('client', labA)
    const first = await connect(sid)
    const start = (first.of('hello')[0].data.versions as Record<string, number>).support
    await support.publishToBoth(labA, { type: 'ticket', ticketId: uuid() })
    await support.publishToBoth(labA, { type: 'ticket', ticketId: uuid() })
    await support.publishToBoth(labA, { type: 'typing', ticketId: uuid(), userId: 'u', name: 'N', side: 'agent' }) // not counted
    await vi.waitFor(() => expect(first.of('typing')).toHaveLength(1))
    expect(first.of('ticket').map((f) => f.data.v)).toEqual([start + 1, start + 2])
    expect(first.of('typing')[0].data.v).toBeUndefined()
    first.stop()

    await support.publishToBoth(labA, { type: 'ticket', ticketId: uuid() })
    const again = await connect(sid)
    expect(again.of('hello')[0].data.versions).toEqual({ support: start + 3 })
  })

  it('events sent by a process still on the previous release are understood', async () => {
    const a = await connect((await login('client', labA)).sid)
    await redis.publish(`sup:lab:${labA}`, JSON.stringify({ type: 'ticket', ticketId: 'old-format' }))
    await vi.waitFor(() => expect(a.of('ticket').at(-1)?.data).toEqual({ type: 'ticket', ticketId: 'old-format' }))
    await redis.publish(`sup:lab:${labA}`, 'not json')
    await wait(100)
    expect(a.ended).toBe(false)
  })

  it('signing out everywhere closes every stream within 2 seconds, and only theirs', async () => {
    const userId = uuid()
    const laptop = await connect((await login('client', labA, userId)).sid)
    const phone = await connect((await login('client', labA, userId)).sid)
    const other = await connect((await login('subuser', labA)).sid)
    const before = Date.now()
    await sessions.destroyAllSessions(userId)
    await vi.waitFor(() => expect([laptop.ended, phone.ended]).toEqual([true, true]), 2000)
    expect(Date.now() - before).toBeLessThan(2000)
    expect(laptop.of('logout')).toHaveLength(1)
    await wait(200)
    expect(other.ended).toBe(false)
  })

  it('signing out on one device leaves the other connected', async () => {
    const userId = uuid()
    const one = await login('client', labA, userId), two = await login('client', labA, userId)
    const laptop = await connect(one.sid), phone = await connect(two.sid)
    await sessions.destroySession(one.sid, userId)
    await vi.waitFor(() => expect(laptop.ended).toBe(true), 2000)
    await wait(200)
    expect(phone.ended).toBe(false)
  })

  it('a browser cannot pretend: someone else\'s session check changes nothing', async () => {
    const a = await connect((await login('client', labA)).sid)
    await publish.publishSessionCheck(uuid())
    await publish.publishLive(publish.userChannel(people.at(-1)!), { type: 'session' }) // own, but still signed in
    await wait(300)
    expect(a.ended).toBe(false)
    expect(a.of('session')).toEqual([]) // internal, never forwarded
  })

  it('limits streams per person and frees them when they close', async () => {
    const { sid, userId } = await login('client', labA)
    const streams = []
    for (let i = 0; i < presence.MAX_STREAMS_PER_USER; i++) streams.push(await connect(sid))
    expect((await connect(sid)).res.status).toBe(429)
    const before = openStreamCount()
    streams[0].stop()
    await vi.waitFor(async () => expect(await redis.zcard(`sup:streams:${userId}`)).toBe(presence.MAX_STREAMS_PER_USER - 1))
    expect(openStreamCount()).toBe(before - 1)
    expect((await connect(sid)).res.status).toBe(200)
  })

  it('present means a visible tab, not an open connection', async () => {
    const { sid, userId } = await login('qc')
    const stream = await connect(sid)
    expect(await presence.presentUsers([userId, uuid()])).toEqual(new Set([userId]))

    // A forgotten tab: the stream stays, nothing reports a visible tab any more
    await redis.del(`live:present:${userId}`)
    await redis.zrem('sup:agents:online', userId)
    await presence.heartbeatStreams([{ userId, connectionId: 'x', isAgent: true }])
    expect(await presence.presentUsers([userId])).toEqual(new Set())
    expect(await redis.zscore('sup:agents:online', userId)).toBeNull()

    // Shown again
    current.sid = sid
    expect((await presenceRoute.POST()).status).toBe(204)
    expect(await presence.presentUsers([userId])).toEqual(new Set([userId]))
    expect(await redis.zscore('sup:agents:online', userId)).not.toBeNull()

    stream.stop()
    await redis.zrem(`sup:streams:${userId}`, 'x')
    await presence.closeStream(userId, 'none')
    expect(await presence.presentUsers([userId])).toEqual(new Set())
    current.sid = undefined
    expect((await presenceRoute.POST()).status).toBe(401)
  })

  it('a designer being around does not make support look online', async () => {
    const { sid, userId } = await login('designer')
    await connect(sid)
    current.sid = sid
    await presenceRoute.POST()
    expect(await redis.zscore('sup:agents:online', userId)).toBeNull()
  })

  it('says hello again after Redis was away, so missed events are noticed', async () => {
    const { sid } = await login('client', labA)
    const a = await connect(sid)
    const hub = (globalThis as unknown as { __liveHub: { connection: { disconnect: (reconnect: boolean) => void } } }).__liveHub
    hub.connection.disconnect(true) // the subscriber loses Redis and comes back
    await redis.eval(`return redis.call('INCR', KEYS[1])`, 1, `ver:live:sup:lab:${labA}`) // an event nobody heard
    await vi.waitFor(() => expect(a.of('hello')).toHaveLength(2), 10_000)
    const [first, second] = a.of('hello').map((f) => (f.data.versions as Record<string, number>).support)
    expect(second).toBe(first + 1)
    await support.publishToBoth(labA, { type: 'ticket', ticketId: 'after' })
    await vi.waitFor(() => expect(a.of('ticket').at(-1)?.data.ticketId).toBe('after'))
  })
})
