/**
 * Losing access takes effect at once: sessions end and signing in again is refused. Real Postgres + Redis.
 * Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… REDIS_URL=redis://localhost:6380 npx vitest run auth-revocation
 *
 * Creates throwaway users and removes them. Never point this at production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: '' }))
vi.mock('@/src/lib/auth/server', () => ({
  getCurrentSession: async () => ({ userId: session.userId }),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: session.userId } }, error: null }) } }),
}))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('losing access (database + Redis)', async () => {
  const { NextRequest } = await import('next/server')
  const { db } = await import('@/src/db')
  const { eq, inArray, sql } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const auth = await import('@/src/lib/auth/auth-service')
  const sessions = await import('@/src/lib/auth/session')
  const { redis } = await import('@/src/lib/redis')
  const clients = await import('@/src/app/api/admin/clients/[id]/route')
  const members = await import('@/src/app/api/admin/members/[id]/route')
  const signInRoute = await import('@/src/app/api/sign-in/route')

  const PASSWORD = 'Str0ng!Passw0rd'
  const u: Record<string, string> = {}
  const email = (key: string) => `support-test-revoke-${key}-${u[key].slice(0, 8)}@example.invalid`

  async function make(key: string, role: 'client' | 'subuser' | 'admin' | 'qc', parent?: string) {
    u[key] = crypto.randomUUID()
    const staff = role === 'admin' || role === 'qc'
    await auth.createUserWithProfile({
      id: u[key], email: email(key), password: PASSWORD,
      profile: { userType: staff ? 'admin_portal' : 'lab_portal', role, status: 'active', fullName: `Revoke ${key}`, clientId: parent ?? null, createdBy: parent ?? null, labName: role === 'client' ? `Revoke Lab ${u[key].slice(0, 8)}` : null },
    })
  }
  async function signIn(key: string): Promise<string> {
    const r = await auth.signIn(email(key), PASSWORD)
    if (!r.ok) throw new Error(`sign-in refused: ${r.reason}`)
    return r.sid
  }
  const alive = async (sid: string) => (await sessions.getSession(sid)) !== null
  async function setLab(key: string, status: string) {
    session.userId = u.admin
    const req = new NextRequest('http://localhost/api', { method: 'PATCH', body: JSON.stringify({ status }) })
    return (await clients.PATCH(req, { params: Promise.resolve({ id: u[key] }) }))!
  }
  async function setMember(key: string, body: Record<string, unknown>) {
    session.userId = u.admin
    const req = new NextRequest('http://localhost/api', { method: 'PATCH', body: JSON.stringify(body) })
    return (await members.PATCH(req, { params: Promise.resolve({ id: u[key] }) }))!
  }

  beforeAll(async () => {
    await make('admin', 'admin')
    await make('qc', 'qc')
    await make('lab', 'client')
    await make('member', 'subuser', u.lab)
    await make('otherLab', 'client')
    await make('otherMember', 'subuser', u.otherLab)
  })

  afterAll(async () => {
    const ids = Object.values(u)
    if (!ids.length) return
    for (const id of ids) await sessions.destroyAllSessions(id)
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.execute(sql`delete from notifications where user_id in ${ids}`)
    await db.delete(users).where(inArray(users.id, ids))
  })

  it('deactivating a lab signs out its owner and every sub-user, on every device, and nobody else', async () => {
    const gone = [await signIn('lab'), await signIn('lab'), await signIn('member'), await signIn('member')]
    const kept = [await signIn('otherLab'), await signIn('otherMember'), await signIn('qc')]
    expect((await setLab('lab', 'inactive')).status).toBe(200)
    expect(await Promise.all(gone.map(alive))).toEqual([false, false, false, false])
    expect(await Promise.all(kept.map(alive))).toEqual([true, true, true])
  })

  it('then neither the owner nor a sub-user can sign back in', async () => {
    expect(await auth.signIn(email('lab'), PASSWORD)).toMatchObject({ ok: false, reason: 'blocked', status: 'inactive', lab: false })
    expect(await auth.signIn(email('member'), PASSWORD)).toMatchObject({ ok: false, reason: 'blocked', status: 'inactive', lab: true })

    const res = await signInRoute.POST(new NextRequest('http://localhost/api/sign-in', { method: 'POST', body: JSON.stringify({ email: email('member'), password: PASSWORD }) }))
    expect(await res.json()).toMatchObject({ isBlocked: true, message: "Your lab's account is inactive. Please contact support." })
    expect(res.cookies.get(sessions.SESSION_COOKIE)).toBeUndefined()
    // A wrong password still learns nothing about the account
    expect(await auth.signIn(email('member'), 'wrong')).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('reactivating lets them back in, and changing it back and forth is safe', async () => {
    expect((await setLab('lab', 'active')).status).toBe(200)
    const sids = [await signIn('lab'), await signIn('member')]
    expect((await setLab('lab', 'active')).status).toBe(200) // already active: nobody is signed out
    expect(await Promise.all(sids.map(alive))).toEqual([true, true])
    expect((await setLab('lab', 'inactive')).status).toBe(200)
    expect((await setLab('lab', 'inactive')).status).toBe(200) // repeating is safe
    expect(await Promise.all(sids.map(alive))).toEqual([false, false])
    await setLab('lab', 'active')
  })

  it('says so when people could not be signed out, and repeating the request finishes the job', async () => {
    const sid = await signIn('member')
    const failing = vi.spyOn(redis, 'smembers').mockRejectedValueOnce(new Error('Redis down') as never)
    const first = await setLab('lab', 'inactive')
    failing.mockRestore()
    expect(first.status).toBe(503)
    expect((await first.json()).error).toMatch(/could not be signed out/)
    expect((await setLab('lab', 'inactive')).status).toBe(200)
    expect(await alive(sid)).toBe(false)
    await setLab('lab', 'active')
  })

  it('someone signing in at the very moment of deactivation does not keep a session', async () => {
    const before = await redis.keys('sess:*')
    const original = redis.multi.bind(redis)
    // The lab is deactivated after the password check, just before the session is stored
    const spy = vi.spyOn(redis, 'multi').mockImplementationOnce(((...args: unknown[]) => {
      const chain = (original as (...a: unknown[]) => ReturnType<typeof redis.multi>)(...args)
      const exec = chain.exec.bind(chain)
      chain.exec = (async () => {
        await db.update(profiles).set({ status: 'inactive' }).where(eq(profiles.id, u.lab))
        await auth.revokeAccess(u.lab)
        return exec()
      }) as typeof chain.exec
      return chain
    }) as never)
    const result = await auth.signIn(email('member'), PASSWORD)
    spy.mockRestore()
    expect(result).toMatchObject({ ok: false, reason: 'blocked', lab: true })
    const mine = await redis.smembers(`user_sess:${u.member}`)
    expect(mine).toEqual([])
    expect((await redis.keys('sess:*')).length).toBeLessThanOrEqual(before.length)
    await setLab('lab', 'active')
  })

  it('staff: deactivating or changing role signs out that person only', async () => {
    const qc = await signIn('qc')
    const lab = await signIn('lab')
    expect((await setMember('qc', { status: 'inactive' })).status).toBe(200)
    expect([await alive(qc), await alive(lab)]).toEqual([false, true])
    expect(await auth.signIn(email('qc'), PASSWORD)).toMatchObject({ ok: false, reason: 'blocked' })
  })

  it('the team page deactivating a lab account also covers its sub-users', async () => {
    const member = await signIn('member')
    expect((await setMember('lab', { status: 'inactive' })).status).toBe(200)
    expect(await alive(member)).toBe(false)
    await setLab('lab', 'active')
  })

  it('deleting a sub-user ends their sessions', async () => {
    const sid = await signIn('otherMember')
    await auth.deleteUser(u.otherMember)
    expect(await alive(sid)).toBe(false)
    expect(await auth.signIn(email('otherMember'), PASSWORD)).toMatchObject({ ok: false, reason: 'invalid' })
  })
})
