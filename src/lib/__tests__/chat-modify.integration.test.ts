/**
 * Editing and deleting case chat messages, through the real route handlers and a real Postgres. Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… REDIS_URL=redis://localhost:6380 npx vitest run chat-modify
 *
 * The job queue, email and R2 are faked. Creates throwaway users and a case and removes them. Never point
 * this at production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: null as string | null }))
const queue = vi.hoisted(() => ({ add: vi.fn(async () => ({ id: 'test' })) }))

vi.mock('@/src/lib/auth/server', () => ({
  getCurrentSession: async () => (session.userId ? { userId: session.userId } : null),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.userId ? { id: session.userId } : null }, error: null }) },
  }),
}))
vi.mock('@/src/lib/queue/client', () => ({ chatQueue: queue, caseCleanupQueue: { addBulk: vi.fn() }, connection: { status: 'ready' } }))
vi.mock('@/src/lib/queue/jobs', () => ({ queueEmail: vi.fn(async () => ({ id: 'test' })) }))
vi.mock('@/src/lib/r2-objects', async (original) => ({
  ...(await original<typeof import('@/src/lib/r2-objects')>()),
  deleteKeys: vi.fn(async () => {
    throw new Error('R2 must not be called from tests')
  }),
}))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('case chat edit / delete (database)', async () => {
  const { NextRequest } = await import('next/server')
  const { db } = await import('@/src/db')
  const { and, eq, inArray, sql } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { cases } = await import('@/src/db/schema/case')
  const { chatMessages } = await import('@/src/db/schema/chat')
  const { files } = await import('@/src/db/schema/files')
  const { notifications } = await import('@/src/db/schema/notification')
  const thread = await import('@/src/app/api/cases/[id]/chat/route')
  const readRoute = await import('@/src/app/api/cases/[id]/chat/read/route')
  const { getCachedData, setCachedData } = await import('@/src/lib/redis-cache')
  const single = await import('@/src/app/api/cases/[id]/chat/[messageId]/route')
  const caseRoute = await import('@/src/app/api/cases/[id]/route')
  const caseList = await import('@/src/app/api/cases/route')
  const { invalidateCasesCache } = await import('@/src/lib/redis-cache')
  const { getCasesChatMetadata } = await import('@/src/lib/chat')
  const chatJobs = await import('@/src/lib/queue/chat-jobs')
  const { queueEmail } = await import('@/src/lib/queue/jobs')
  const { CHAT_EMAIL_DELAY_MS } = await import('@/src/lib/chat-rules')

  const u: Record<string, string> = {}
  const emails: Record<string, string> = {}
  let caseId = ''
  let otherCaseId = ''

  async function makeUser(key: string, role: string, userType: 'lab_portal' | 'admin_portal', clientOf?: string) {
    const id = crypto.randomUUID()
    u[key] = id
    emails[key] = `support-test-${id}@example.invalid`
    await db.insert(users).values({ id, email: emails[key], passwordHash: 'x' })
    await db.insert(profiles).values({
      id, userType, role: role as never, status: 'active', fullName: `Chat ${key}`,
      clientId: role === 'client' ? id : clientOf ?? null,
      createdBy: clientOf ?? null,
      labName: role === 'client' ? `Chat Lab ${id.slice(0, 8)}` : null,
    })
  }

  const url = 'http://localhost/api'
  const json = (method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body) })
  const as = (key: string | null) => { session.userId = key ? u[key] : null }

  async function send(key: string, text: string, extra: Record<string, unknown> = {}): Promise<string> {
    as(key)
    const res = await thread.POST(json('POST', { messageText: text, ...extra }), { params: Promise.resolve({ id: caseId }) })
    expect(res.status).toBe(200)
    return (await res.json()).data.id
  }
  async function edit(key: string | null, messageId: string, messageText: unknown, inCase = caseId) {
    as(key)
    const res = await single.PATCH(json('PATCH', { messageText }), { params: Promise.resolve({ id: inCase, messageId }) })
    return { status: res.status, body: await res.json() }
  }
  async function remove(key: string | null, messageId: string, inCase = caseId) {
    as(key)
    const res = await single.DELETE(new NextRequest(url, { method: 'DELETE' }), { params: Promise.resolve({ id: inCase, messageId }) })
    return { status: res.status, body: res.status === 204 ? null : await res.json() }
  }
  async function view(key: string, messageId: string) {
    as(key)
    const res = await thread.GET(new NextRequest(url), { params: Promise.resolve({ id: caseId }) })
    return ((await res.json()).data as Array<Record<string, unknown>>).find((m) => m.id === messageId)!
  }
  async function load(key: string, params = '') {
    as(key)
    const res = await thread.GET(new NextRequest(`${url}${params}`), { params: Promise.resolve({ id: caseId }) })
    return { status: res.status, body: (await res.json()) as { data: Array<Record<string, unknown>>; cursor: string; hasMore?: boolean; changes?: boolean } }
  }
  async function seen(key: string, messageId: string) {
    as(key)
    const res = await readRoute.POST(json('POST', { messageId }), { params: Promise.resolve({ id: caseId }) })
    return { status: res.status, body: await res.json() }
  }
  const row = async (id: string) => (await db.select().from(chatMessages).where(eq(chatMessages.id, id)))[0]
  const age = (id: string, seconds: number) =>
    db.update(chatMessages).set({ createdAt: sql`clock_timestamp() - make_interval(secs => ${seconds}::int)` }).where(eq(chatMessages.id, id))
  const notes = (messageId: string) =>
    db.select().from(notifications).where(and(eq(notifications.type, 'chat_message'), sql`${notifications.metadata}->>'messageId' = ${messageId}`))

  beforeAll(async () => {
    await makeUser('lab', 'client', 'lab_portal')
    await makeUser('member', 'subuser', 'lab_portal', u.lab)
    await makeUser('otherLab', 'client', 'lab_portal')
    await makeUser('designer', 'designer', 'admin_portal')
    await makeUser('stranger', 'designer', 'admin_portal')
    const tag = crypto.randomUUID().slice(0, 8)
    const [a, b] = await db.insert(cases).values([
      { caseNumber: `CHAT-${tag}-1`, clientId: u.lab, subuserId: u.member, designerId: u.designer, category: 'test', status: 'in_progress' as never },
      { caseNumber: `CHAT-${tag}-2`, clientId: u.otherLab, designerId: u.designer, category: 'test', status: 'in_progress' as never },
    ] as never).returning({ id: cases.id })
    caseId = a.id
    otherCaseId = b.id
  })

  beforeEach(() => {
    queue.add.mockClear()
    vi.mocked(queueEmail).mockClear()
  })

  afterAll(async () => {
    const ids = Object.values(u)
    if (ids.length === 0) return
    // Includes the in-app notifications the test created for real local admins
    await db.execute(sql`delete from notifications where metadata->>'caseId' in (${caseId}, ${otherCaseId})`)
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.delete(cases).where(inArray(cases.id, [caseId, otherCaseId].filter(Boolean)))
    await db.delete(users).where(inArray(users.id, ids))
  })

  it('every role can edit its own message; others see the new text marked as edited', async () => {
    for (const key of ['lab', 'member', 'designer']) {
      const id = await send(key, `from ${key}`)
      expect(await view(key, id)).toMatchObject({ canEdit: true, canDelete: true })
      expect(await view(key === 'lab' ? 'designer' : 'lab', id)).toMatchObject({ canEdit: false, canDelete: false, msLeft: 0 })
      expect((await edit(key, id, '  corrected  ')).status).toBe(200)
      const seen = await view(key === 'lab' ? 'designer' : 'lab', id)
      expect(seen).toMatchObject({ messageText: 'corrected', deleted: false })
      expect(seen.editedAt).toBeTruthy()
    }
  })

  it('refuses everyone but the sender, and people without access to the case', async () => {
    const id = await send('lab', 'mine')
    expect(await edit('designer', id, 'x')).toMatchObject({ status: 403, body: { code: 'not_sender' } })
    expect(await edit('member', id, 'x')).toMatchObject({ status: 403, body: { code: 'not_sender' } }) // same lab, other person
    expect((await remove('designer', id)).status).toBe(403)
    expect((await edit('otherLab', id, 'x')).status).toBe(403)
    expect((await remove('stranger', id)).status).toBe(403)
    expect((await edit(null, id, 'x')).status).toBe(401)
    expect((await row(id)).messageText).toBe('mine')
  })

  it('does not reach a message through another case, or with bad ids or text', async () => {
    const id = await send('designer', 'in case one')
    expect((await edit('designer', id, 'x', otherCaseId)).status).toBe(404)
    expect((await remove('designer', id, otherCaseId)).status).toBe(404)
    expect((await edit('designer', 'not-a-uuid', 'x')).status).toBe(404)
    expect((await edit('designer', crypto.randomUUID(), 'x')).status).toBe(404)
    for (const bad of ['', '   ', null, 5, 'x'.repeat(10_001)]) expect((await edit('designer', id, bad)).status).toBe(400)
    expect((await row(id)).messageText).toBe('in case one')
  })

  it('closes after 2 minutes (plus a few seconds of grace for a last-moment click)', async () => {
    const id = await send('lab', 'timed')
    await age(id, 119)
    expect((await edit('lab', id, 'just in time')).status).toBe(200)
    await age(id, 122) // the buttons are gone, but a click already on its way still counts
    expect(await view('lab', id)).toMatchObject({ canEdit: false, canDelete: false, msLeft: 0 })
    expect((await edit('lab', id, 'in the grace period')).status).toBe(200)
    await age(id, 126)
    expect(await edit('lab', id, 'too late')).toMatchObject({ status: 409, body: { code: 'window_closed' } })
    expect(await remove('lab', id)).toMatchObject({ status: 409, body: { code: 'window_closed' } })
    expect((await row(id)).messageText).toBe('in the grace period')
  })

  it('deleting erases the text, leaves a placeholder, and cannot be undone or repeated', async () => {
    const id = await send('lab', 'secret text')
    expect((await remove('lab', id)).status).toBe(204)
    expect(await row(id)).toMatchObject({ messageText: '' })
    expect(await view('designer', id)).toMatchObject({ deleted: true, messageText: '', canEdit: false })
    expect(await edit('lab', id, 'back again')).toMatchObject({ status: 409, body: { code: 'deleted' } })
    expect(await remove('lab', id)).toMatchObject({ status: 409, body: { code: 'deleted' } })
    // The database itself refuses to keep text on a deleted message
    await expect(db.update(chatMessages).set({ messageText: 'x' }).where(eq(chatMessages.id, id))).rejects.toThrow()
  })

  it('exactly one of two simultaneous deletes wins', async () => {
    const id = await send('lab', 'race')
    const results = await Promise.all([remove('lab', id), remove('lab', id)])
    expect(results.map((r) => r.status).sort()).toEqual([204, 409])
  })

  it('attachments: delete only; the file record goes and the stored file is queued for removal', async () => {
    const key = `Chat Lab/uploads/${crypto.randomUUID()}/scan.png`
    const fileUrl = `/api/cases/files?labName=${encodeURIComponent('Chat Lab')}&fileName=${encodeURIComponent(key.slice('Chat Lab/'.length))}`
    const id = await send('designer', 'Shared an attachment: scan.png', { fileUrl, fileName: 'scan.png', fileType: 'image/png', fileSize: 10 })
    expect(await view('designer', id)).toMatchObject({ canEdit: false, canDelete: true, fileName: 'scan.png' })
    expect(await edit('designer', id, 'x')).toMatchObject({ status: 409, body: { code: 'attachment' } })

    // While any record still uses the object it is kept
    const deleteKeys = vi.fn(async (keys: string[]) => keys.length)
    expect(await chatJobs.removeUnreferencedUploads([key], { deleteKeys })).toEqual({ removed: 0 })
    expect(deleteKeys).not.toHaveBeenCalled()

    queue.add.mockClear()
    expect((await remove('designer', id)).status).toBe(204)
    expect(await db.select().from(files).where(eq(files.messageId, id))).toHaveLength(0)
    expect(await view('lab', id)).toMatchObject({ deleted: true, fileUrl: null, fileName: null })
    expect(queue.add).toHaveBeenCalledWith('attachment-cleanup', { kind: 'attachment-cleanup', messageId: id, keys: [key] }, expect.objectContaining({ delay: 0 }))
    expect(await chatJobs.removeUnreferencedUploads([key], { deleteKeys })).toEqual({ removed: 1 })
    expect(deleteKeys).toHaveBeenCalledWith([key])
  })

  it('never removes a stored file that is not a private upload (someone could point a message at it)', async () => {
    const deleteKeys = vi.fn(async (keys: string[]) => keys.length)
    const foreign = ['Other Lab/scan.stl', 'bulk-staging/x/y.zip', 'db-backups/uploads/dump.sql', 'https://x.test/uploads/00000000-0000-4000-8000-000000000000/a.png', 'Lab/uploads/not-a-uuid/a.png']
    expect(await chatJobs.removeUnreferencedUploads(foreign, { deleteKeys })).toEqual({ removed: 0 })
    expect(deleteKeys).not.toHaveBeenCalled()

    const id = await send('lab', 'x', { fileUrl: '/api/cases/files?labName=Other%20Lab&fileName=scan.stl', fileName: 'scan.stl' })
    queue.add.mockClear()
    expect((await remove('lab', id)).status).toBe(204)
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('keeps case-action lines and rejected cases locked', async () => {
    const action = await send('lab', '[CHANGE REQUEST]: thinner margins')
    expect(await edit('lab', action, 'x')).toMatchObject({ status: 409, body: { code: 'case_action' } })
    expect(await remove('lab', action)).toMatchObject({ status: 409, body: { code: 'case_action' } })

    const id = await send('lab', 'before rejection')
    await db.update(cases).set({ status: 'client_reject' as never }).where(eq(cases.id, caseId))
    try {
      expect(await edit('lab', id, 'x')).toMatchObject({ status: 409, body: { code: 'chat_locked' } })
      expect(await remove('lab', id)).toMatchObject({ status: 409, body: { code: 'chat_locked' } })
      expect(await view('lab', id)).toMatchObject({ canEdit: false, canDelete: false })
    } finally {
      await db.update(cases).set({ status: 'in_progress' as never }).where(eq(cases.id, caseId))
    }
  })

  it('in-app notifications follow the message: updated on edit, removed on delete', async () => {
    const id = await send('lab', 'first version')
    const unrelated = await send('lab', 'another message')
    const before = await notes(id)
    expect(before.map((n) => n.userId)).toEqual(expect.arrayContaining([u.designer, u.member]))
    expect(before.map((n) => n.userId)).not.toContain(u.lab)

    await edit('lab', id, 'second version')
    expect((await notes(id)).every((n) => n.message === 'Chat lab: second version')).toBe(true)
    await remove('lab', id)
    expect(await notes(id)).toHaveLength(0)
    expect((await notes(unrelated)).every((n) => n.message === 'Chat lab: another message')).toBe(true)
  })

  it('emails wait until the message can no longer change: final text, and nothing if deleted', async () => {
    const id = await send('lab', 'draft wording')
    expect(queueEmail).not.toHaveBeenCalled()
    expect(queue.add).toHaveBeenCalledWith('email', { kind: 'email', messageId: id }, expect.objectContaining({ delay: CHAT_EMAIL_DELAY_MS }))
    await edit('lab', id, 'final wording')
    const inAppBefore = (await notes(id)).length
    const result = await chatJobs.processChatJob({ kind: 'email', messageId: id })
    expect(result).toMatchObject({ skipped: false })
    const sent = vi.mocked(queueEmail).mock.calls.map(([d]) => d)
    expect(sent.map((d) => d.to)).toEqual(expect.arrayContaining([emails.designer, emails.member]))
    expect(sent.map((d) => d.to)).not.toContain(emails.lab)
    expect(sent.every((d) => d.html.includes('final wording') && !d.html.includes('draft wording'))).toBe(true)
    expect((await notes(id)).length).toBe(inAppBefore) // the email job adds no second in-app notification

    vi.mocked(queueEmail).mockClear()
    const gone = await send('lab', 'regretted')
    await remove('lab', gone)
    expect(await chatJobs.processChatJob({ kind: 'email', messageId: gone })).toEqual({ emailed: 0, skipped: true })
    expect(queueEmail).not.toHaveBeenCalled()
  })

  it('deleted messages stop counting towards the unread badge and today\'s count', async () => {
    const [fresh] = await db.insert(cases).values({
      caseNumber: `CHAT-${crypto.randomUUID().slice(0, 8)}-3`, clientId: u.lab, designerId: u.designer, category: 'test', status: 'in_progress',
    } as never).returning({ id: cases.id })
    const main = caseId
    caseId = fresh.id
    try {
      const id = await send('lab', 'badge')
      expect((await getCasesChatMetadata([fresh.id], u.designer)).get(fresh.id)).toEqual({ todayMessagesCount: 1, hasUnreadChat: true })
      await remove('lab', id)
      expect((await getCasesChatMetadata([fresh.id], u.designer)).get(fresh.id)).toEqual({ todayMessagesCount: 0, hasUnreadChat: false })
    } finally {
      caseId = main
      await db.execute(sql`delete from notifications where metadata->>'caseId' = ${fresh.id}`)
      await db.delete(cases).where(eq(cases.id, fresh.id))
    }
  })

  it('the unread badge comes back for a message sent after the last visit', async () => {
    const badge = async (key: string) => (await getCasesChatMetadata([caseId], u[key])).get(caseId)!.hasUnreadChat
    const first = await send('lab', 'one')
    expect(await badge('designer')).toBe(true)
    await view('designer', first)
    expect(await badge('designer')).toBe(true) // loading alone marks nothing
    await seen('designer', first)
    expect(await badge('designer')).toBe(false)
    const second = await send('lab', 'two')
    expect(await badge('designer')).toBe(true)
    expect(await badge('lab')).toBe(false) // never for one's own message
    await remove('lab', second)
    expect(await badge('designer')).toBe(false)
  })

  it('the cases list shows each person their own badge, even when the list itself comes from the cache', async () => {
    const id = await send('designer', 'for the lab')
    await invalidateCasesCache(u.lab)
    const badge = async (key: string) => {
      as(key)
      const res = await caseList.GET(new NextRequest('http://localhost/api/cases?limit=100&page=1'))
      const found = ((await res.json()).data as Array<{ id: string; hasUnreadChat: boolean }>).find((c) => c.id === caseId)
      return { unread: found!.hasUnreadChat, cached: res.headers.get('Server-Timing')!.includes('cache;dur') }
    }
    expect(await badge('lab')).toEqual({ unread: true, cached: false }) // fills the shared cache
    await seen('lab', id) // the owner reads the chat
    expect(await badge('lab')).toEqual({ unread: false, cached: true })
    expect(await badge('member')).toEqual({ unread: true, cached: true }) // same cached list, not yet read
    await invalidateCasesCache(u.lab)
  })

  describe('a lab rejecting its case', () => {
    const review = () => db.update(cases).set({ status: 'submitted_to_client' as never }).where(eq(cases.id, caseId))
    async function reject(key: string, reason: unknown) {
      as(key)
      const res = await caseRoute.PUT(json('PUT', { status: 'client_reject', clientMassage: reason }), { params: Promise.resolve({ id: caseId }) })
      return res.status
    }
    const lines = async () =>
      (await db.select().from(chatMessages).where(eq(chatMessages.caseId, caseId))).filter((m) => m.messageText.startsWith('[CASE REJECTED]:'))
    const reset = async () => {
      await db.update(cases).set({ status: 'in_progress' as never }).where(eq(cases.id, caseId))
      await db.delete(chatMessages).where(and(eq(chatMessages.caseId, caseId), sql`${chatMessages.messageText} like '[CASE REJECTED]:%'`))
    }

    it('puts the reason in the chat, tells everyone on the case, and locks the line', async () => {
      await review()
      try {
        expect(await reject('lab', '  wrong tooth  ')).toBe(200)
        const [line] = await lines()
        expect(line).toMatchObject({ messageText: '[CASE REJECTED]: wrong tooth', senderId: u.lab, senderRole: 'client' })
        expect(await view('designer', line.id)).toMatchObject({ messageText: '[CASE REJECTED]: wrong tooth' })
        expect((await notes(line.id)).map((n) => n.userId)).toEqual(expect.arrayContaining([u.designer, u.member]))
        expect(queue.add).toHaveBeenCalledWith('email', { kind: 'email', messageId: line.id }, expect.anything())
        expect((await remove('lab', line.id)).status).toBe(409)
      } finally {
        await reset()
      }
    })

    it('writes the line once on a double submit', async () => {
      await review()
      try {
        await Promise.all([reject('lab', 'twice'), reject('lab', 'twice')])
        expect(await lines()).toHaveLength(1)
      } finally {
        await reset()
      }
    })

    it('writes nothing when the rejection is refused or has no reason', async () => {
      expect(await reject('lab', 'not in review')).toBe(400)
      expect(await reject('otherLab', 'not my case')).toBe(403)
      expect(await lines()).toHaveLength(0)
      await review()
      try {
        expect(await reject('lab', '   ')).toBe(200)
        expect(await lines()).toHaveLength(0)
      } finally {
        await reset()
      }
    })
  })

  describe('loading only what changed', () => {
    const ids = (r: { body: { data: Array<Record<string, unknown>> } }) => r.body.data.map((m) => m.id)

    it('returns new, edited and deleted messages, and nothing else', async () => {
      const old = await send('lab', 'old')
      await db.update(chatMessages).set({ messageText: 'old' }).where(eq(chatMessages.id, old))
      const first = await load('designer')
      expect(first.body.changes).toBeUndefined()
      // Step past the 10-second overlap
      const cursor = String(Number(first.body.cursor) + 10_000)
      expect(ids(await load('designer', `?since=${cursor}`))).toEqual([])

      const fresh = await send('lab', 'fresh')
      await edit('lab', old, 'old, corrected')
      const changed = await load('designer', `?since=${cursor}`)
      expect(changed.body.changes).toBe(true)
      expect(ids(changed).sort()).toEqual([old, fresh].sort())
      await remove('lab', fresh)
      const later = await load('designer', `?since=${cursor}`)
      expect(later.body.data.find((m) => m.id === fresh)).toMatchObject({ deleted: true, messageText: '' })
    })

    it('an idle refresh makes 2 queries, writes nothing and answers in under 1 KB', async () => {
      const { body } = await load('designer')
      const statements: string[] = []
      const session = (db as unknown as { session: { logger: { logQuery: (q: string) => void } } }).session
      const original = session.logger.logQuery
      session.logger.logQuery = (q) => { statements.push(q) }
      const states = () => db.execute(sql`select count(*)::int n, max(last_read_at)::text t from chat_read_states where case_id = ${caseId}::uuid`)
      try {
        const before = JSON.stringify(await states())
        statements.length = 0
        const idle = await load('designer', `?since=${Number(body.cursor) + 10_000}`)
        const during = [...statements]
        expect(JSON.stringify(idle.body).length).toBeLessThan(1024)
        expect(during).toHaveLength(2)
        expect(during.every((q) => /^select/i.test(q.trim()))).toBe(true)
        expect(JSON.stringify(await states())).toBe(before)
      } finally {
        session.logger.logQuery = original
      }
    })

    it('pages through a long conversation without gaps or repeats', async () => {
      const main = caseId
      const [long] = await db.insert(cases).values({ caseNumber: `CHAT-${crypto.randomUUID().slice(0, 8)}-L`, clientId: u.lab, designerId: u.designer, category: 'test', status: 'in_progress' } as never).returning({ id: cases.id })
      caseId = long.id
      try {
        // Many share one timestamp: paging must not depend on distinct times
        const at = new Date(Date.now() - 3600_000)
        await db.insert(chatMessages).values(Array.from({ length: 120 }, (_, i) => ({ caseId: long.id, senderId: u.lab, senderRole: 'client' as const, messageText: `m${i}`, createdAt: new Date(at.getTime() + Math.floor(i / 40) * 1000) })))
        const pages = [await load('designer')]
        while (pages.at(-1)!.body.hasMore) pages.push(await load('designer', `?before=${pages.at(-1)!.body.data.at(-1)!.id}`))
        const all = pages.flatMap((x) => ids(x))
        expect(pages.map((x) => x.body.data.length)).toEqual([50, 50, 20])
        expect(new Set(all).size).toBe(120)
        // Away for a long time: a fresh page instead of hundreds of changes
        await db.insert(chatMessages).values(Array.from({ length: 150 }, (_, i) => ({ caseId: long.id, senderId: u.lab, senderRole: 'client' as const, messageText: `n${i}` })))
        const back = await load('designer', '?since=1')
        expect(back.body.changes).toBeUndefined()
        expect(back.body.data).toHaveLength(50)
      } finally {
        caseId = main
        await db.delete(cases).where(eq(cases.id, long.id))
      }
    })

    it('refuses bad requests and people without access', async () => {
      expect((await load('designer', '?since=abc')).status).toBe(400)
      expect((await load('designer', '?before=1')).status).toBe(400)
      expect((await load('otherLab', '?since=1')).status).toBe(403)
      expect((await load('stranger')).status).toBe(403)
      const id = await send('lab', 'x')
      expect((await seen('otherLab', id)).status).toBe(403)
      expect((await seen('designer', 'nope')).status).toBe(400)
    })
  })

  describe('marking as read', () => {
    const readAt = async (key: string) =>
      ((await db.execute(sql`select last_read_at::text t from chat_read_states where case_id = ${caseId}::uuid and user_id = ${u[key]}::uuid`)) as unknown as Array<{ t: string }>)[0]?.t

    it('goes up to the message seen, never backwards, and leaves later notifications unread', async () => {
      const one = await send('lab', 'one')
      const two = await send('lab', 'two')
      const unread = async (id: string) => (await notes(id)).find((n) => n.userId === u.designer)!.read === false
      expect((await seen('designer', one)).body.notificationsRead).toBeGreaterThanOrEqual(1)
      expect([await unread(one), await unread(two)]).toEqual([false, true])
      expect((await getCasesChatMetadata([caseId], u.designer)).get(caseId)!.hasUnreadChat).toBe(true)

      await seen('designer', two)
      const latest = await readAt('designer')
      expect(await unread(two)).toBe(false)
      expect((await seen('designer', one)).body.notificationsRead).toBe(0)
      expect(await readAt('designer')).toBe(latest)
    })

    it('a message from another case cannot move the read position', async () => {
      const [foreign] = await db.insert(chatMessages).values({ caseId: otherCaseId, senderId: u.otherLab, senderRole: 'client', messageText: 'x', createdAt: new Date(Date.now() + 60_000) }).returning()
      const before = await readAt('designer')
      expect((await seen('designer', foreign.id)).body.notificationsRead).toBe(0)
      expect(await readAt('designer')).toBe(before)
    })

    it('a new message and reading it both refresh the bell and dots at once (no stale cache)', async () => {
      const key = `sidebar-badges:${u.designer}`
      await setCachedData(key, { notifications: false }, 60)
      const id = await send('lab', 'ring')
      expect(await getCachedData(key)).toBeNull()
      await setCachedData(key, { notifications: true }, 60)
      await setCachedData(`notifications:${u.designer}:unread`, { count: 1 }, 60)
      await seen('designer', id)
      expect(await getCachedData(key)).toBeNull()
      expect(await getCachedData(`notifications:${u.designer}:unread`)).toBeNull()
    })
  })

  it('records who changed what, without the text and outside the timeline labs see', async () => {
    const id = await send('designer', 'confidential-original')
    await edit('designer', id, 'confidential-edited')
    await remove('designer', id)
    const logs = (await db.execute(sql`select action, case_id, details::text as details from activity_logs where user_id = ${u.designer} and details->>'messageId' = ${id}`)) as unknown as Array<{ action: string; case_id: string | null; details: string }>
    expect(logs.map((l) => l.action).sort()).toEqual(['chat.message_deleted', 'chat.message_edited'])
    expect(logs.every((l) => l.case_id === null && !l.details.includes('confidential'))).toBe(true)
  })
})
