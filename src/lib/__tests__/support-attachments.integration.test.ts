/**
 * Support attachments against a real Postgres, with R2 replaced by an in-memory fake (nothing is
 * uploaded anywhere). Off by default:
 *
 *   SUPPORT_DB_TEST=1 DATABASE_URL=postgresql://…localhost… npx vitest run support-attachments
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// In-memory "bucket": object key → size. Tests decide what HEAD reports.
const stored = vi.hoisted(() => ({ sizes: new Map<string, number>(), deleted: [] as string[], aborted: [] as string[] }))

vi.mock('@/src/lib/r2', () => ({
  R2_BUCKET: 'test-bucket',
  r2: {
    send: vi.fn(async (command: { constructor: { name: string }; input: { Key: string } }) => {
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          return { UploadId: `upload-${command.input.Key}` }
        case 'CompleteMultipartUploadCommand':
          return {}
        case 'HeadObjectCommand':
          return { ContentLength: stored.sizes.get(command.input.Key) ?? 0 }
        case 'DeleteObjectCommand':
          stored.deleted.push(command.input.Key)
          return {}
        case 'AbortMultipartUploadCommand':
          stored.aborted.push(command.input.Key)
          return {}
        default:
          throw new Error(`Unexpected R2 command ${command.constructor.name}`)
      }
    }),
  },
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { input: { Key: string; PartNumber?: number } }) =>
    `https://signed.example/${command.input.Key}${command.input.PartNumber ? `?part=${command.input.PartNumber}` : ''}`),
}))
vi.mock('@/src/lib/support/notify', () => ({
  notifyTicketCreated: vi.fn(async () => {}),
  notifyNewMessage: vi.fn(async () => {}),
  notifyStatusChange: vi.fn(async () => {}),
  notifyAssigned: vi.fn(async () => {}),
}))

const enabled = process.env.SUPPORT_DB_TEST === '1'

describe.runIf(enabled)('support attachments (database, fake storage)', async () => {
  const { db } = await import('@/src/db')
  const { sql, eq, inArray } = await import('drizzle-orm')
  const { users, profiles } = await import('@/src/db/schema/profile')
  const { files } = await import('@/src/db/schema/files')
  const { supAttachments, supTickets } = await import('@/src/db/schema/support')
  const service = await import('@/src/lib/support/service')
  const attachments = await import('@/src/lib/support/attachments')
  const queries = await import('@/src/lib/support/queries')

  type Caller = Parameters<typeof service.createTicket>[0]
  const ids: string[] = []
  const callers: Record<string, Caller> = {}
  const uuid = () => crypto.randomUUID()

  async function makeUser(key: string, role: string, userType: 'lab_portal' | 'admin_portal', clientOf?: string) {
    const id = uuid()
    ids.push(id)
    await db.insert(users).values({ id, email: `support-att-${id}@example.invalid`, passwordHash: 'x' })
    const clientId = role === 'client' ? id : clientOf ?? null
    const labName = role === 'client' ? `Att Lab ${key}` : null
    await db.insert(profiles).values({ id, userType, role: role as never, status: 'active', clientId, fullName: `Att ${key}`, labName })
    callers[key] = { actor: { id, role, clientId }, profile: { id, userType, role: role as never, fullName: `Att ${key}`, labName, clientId } }
  }

  /** Runs the upload protocol the browser follows; `storedSize` is what the fake bucket ends up holding. */
  async function upload(caller: Caller, fileName: string, size: number, ticketId?: string, storedSize = size) {
    const start = await attachments.startUpload(caller.actor, { fileName, fileSize: size, ticketId })
    const [row] = await db.select({ key: files.r2Key }).from(files)
      .innerJoin(supAttachments, eq(supAttachments.fileId, files.id)).where(eq(supAttachments.id, start.attachmentId))
    stored.sizes.set(row.key, storedSize)
    const parts = start.parts.map((p) => ({ partNumber: p.partNumber, etag: `"etag-${p.partNumber}"` }))
    return { start, key: row.key, complete: () => attachments.completeUpload(caller.actor, start.attachmentId, parts) }
  }

  beforeAll(async () => {
    await makeUser('labA', 'client', 'lab_portal')
    await makeUser('labB', 'client', 'lab_portal')
    await makeUser('agent', 'qc', 'admin_portal')
  })

  afterAll(async () => {
    if (ids.length === 0) return
    await db.delete(supTickets).where(inArray(supTickets.clientId, ids))
    await db.delete(files).where(inArray(files.clientId, ids))
    await db.execute(sql`delete from activity_logs where user_id in ${ids}`)
    await db.delete(users).where(inArray(users.id, ids))
  })

  let ticketId = ''

  it('uploads a screenshot for a new conversation and attaches it to the first message', async () => {
    const shot = await upload(callers.labA, 'error screen.png', 120_000)
    expect(shot.start.parts).toHaveLength(1)
    expect(shot.key).toMatch(new RegExp(`^support/${callers.labA.actor.id}/new/[0-9a-f-]{36}/error_screen\\.png$`))
    const view = await shot.complete()
    expect(view).toMatchObject({ kind: 'image', contentType: 'image/png', sizeBytes: 120_000, status: 'ready' })

    const created = await service.createTicket(callers.labA, {
      subject: 'Upload error',
      category: 'technical',
      message: 'See the screenshot',
      attachmentIds: [shot.start.attachmentId],
    })
    ticketId = created.ticketId
    const thread = await queries.listMessages(callers.agent.actor, ticketId, { limit: 50 })
    expect(thread.messages[0].attachments).toEqual([expect.objectContaining({ fileName: 'error screen.png', status: 'ready' })])
    const [file] = await db.select().from(files).where(eq(files.r2Key, shot.key))
    expect(file).toMatchObject({ kind: 'support', status: 'ready', supportTicketId: ticketId })
  })

  it('splits a 300 MB video into 64 MB parts and allows an attachment-only message', async () => {
    const video = await upload(callers.agent, 'walkthrough.mp4', 300 * 1024 * 1024, ticketId)
    expect(video.start.parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5])
    await video.complete()
    const { message } = await service.postMessage(callers.agent, ticketId, {
      body: '',
      visibility: 'public',
      clientMsgId: uuid(),
      attachmentIds: [video.start.attachmentId],
    })
    expect(message.attachments).toEqual([expect.objectContaining({ kind: 'video', contentType: 'video/mp4' })])
    const list = await queries.listTickets(callers.labA.actor, { view: 'all', limit: 10 })
    expect(list.tickets.find((t) => t.id === ticketId)?.preview).toBe('Attachment')
    // The lab can stream it: a signed URL, inline
    expect(await attachments.attachmentUrl(callers.labA.actor, video.start.attachmentId, false)).toMatch(/^https:\/\/signed\.example\/support\//)
  })

  it('rejects a stored object whose size does not match, and deletes it', async () => {
    const bad = await upload(callers.labA, 'report.pdf', 50_000, ticketId, 49_999)
    await expect(bad.complete()).rejects.toMatchObject({ status: 400, code: 'size_mismatch' })
    expect(stored.deleted).toContain(bad.key)
    const [file] = await db.select({ status: files.status }).from(files).where(eq(files.r2Key, bad.key))
    expect(file.status).toBe('failed')
    await expect(
      service.postMessage(callers.labA, ticketId, { body: 'x', visibility: 'public', clientMsgId: uuid(), attachmentIds: [bad.start.attachmentId] }),
    ).rejects.toMatchObject({ code: 'invalid_attachments' })
  })

  it("never lets someone send another person's upload, or move one to another lab's conversation", async () => {
    const mine = await upload(callers.labA, 'mine.png', 1000)
    await mine.complete()
    await expect(
      service.postMessage(callers.agent, ticketId, { body: 'stolen', visibility: 'public', clientMsgId: uuid(), attachmentIds: [mine.start.attachmentId] }),
    ).rejects.toMatchObject({ code: 'invalid_attachments' })
    const other = await service.createTicket(callers.labB, { subject: 'Lab B issue', category: 'other', message: 'hello' })
    // Lab A's "new conversation" upload can't be smuggled into lab B's conversation
    await expect(
      service.postMessage(callers.labA, other.ticketId, { body: 'x', visibility: 'public', clientMsgId: uuid(), attachmentIds: [mine.start.attachmentId] }),
    ).rejects.toMatchObject({ status: 404 })
    // And lab B can't upload into lab A's conversation
    await expect(attachments.startUpload(callers.labB.actor, { fileName: 'x.png', fileSize: 10, ticketId })).rejects.toMatchObject({ status: 404 })
  })

  it('keeps files on internal notes away from the lab', async () => {
    const internal = await upload(callers.agent, 'internal-log.txt', 2048, ticketId)
    await internal.complete()
    await service.postMessage(callers.agent, ticketId, { body: 'Server log', visibility: 'note', clientMsgId: uuid(), attachmentIds: [internal.start.attachmentId] })
    await expect(attachments.attachmentUrl(callers.labA.actor, internal.start.attachmentId, true)).rejects.toMatchObject({ status: 404 })
    expect(await attachments.attachmentUrl(callers.agent.actor, internal.start.attachmentId, true)).toMatch(/^https:\/\/signed\.example\//)
    const labThread = await queries.listMessages(callers.labA.actor, ticketId, { limit: 50 })
    expect(labThread.messages.flatMap((m) => m.attachments).map((a) => a.fileName)).not.toContain('internal-log.txt')
  })

  it('reports files removed by retention as expired (message text stays)', async () => {
    const old = await upload(callers.labA, 'old.pdf', 3000, ticketId)
    await old.complete()
    const { message } = await service.postMessage(callers.labA, ticketId, { body: 'Old invoice', visibility: 'public', clientMsgId: uuid(), attachmentIds: [old.start.attachmentId] })
    await db.update(files).set({ status: 'purged', purgedAt: new Date() }).where(eq(files.r2Key, old.key))
    await expect(attachments.attachmentUrl(callers.labA.actor, old.start.attachmentId, false)).rejects.toMatchObject({ status: 410, code: 'expired' })
    const thread = await queries.listMessages(callers.labA.actor, ticketId, { limit: 50 })
    const shown = thread.messages.find((m) => m.id === message.id)!
    expect(shown.body).toBe('Old invoice')
    expect(shown.attachments[0].status).toBe('expired')
  })

  it('rejects files that are not allowed before anything is stored', async () => {
    await expect(attachments.startUpload(callers.labA.actor, { fileName: 'tool.exe', fileSize: 10, ticketId })).rejects.toMatchObject({ code: 'file_not_allowed' })
    await expect(attachments.startUpload(callers.labA.actor, { fileName: 'huge.mp4', fileSize: 501 * 1024 * 1024, ticketId })).rejects.toMatchObject({ code: 'file_not_allowed' })
    // Agents attach inside a conversation, not to a not-yet-created one
    await expect(attachments.startUpload(callers.agent.actor, { fileName: 'a.png', fileSize: 10 })).rejects.toMatchObject({ code: 'ticket_required' })
  })

  it('cancels uploads and reaps the ones never sent', async () => {
    const cancelled = await upload(callers.labA, 'cancel-me.png', 500, ticketId)
    await attachments.abortUpload(callers.labA.actor, cancelled.start.attachmentId)
    expect(stored.aborted).toContain(cancelled.key)
    expect(await db.select().from(files).where(eq(files.r2Key, cancelled.key))).toHaveLength(0)

    const forgotten = await upload(callers.labA, 'forgotten.png', 500, ticketId)
    await forgotten.complete()
    const unfinished = await upload(callers.labA, 'unfinished.mov', 500, ticketId)
    // Pretend both were started two days ago
    await db.update(supAttachments).set({ createdAt: new Date(Date.now() - 48 * 3600_000) })
      .where(inArray(supAttachments.id, [forgotten.start.attachmentId, unfinished.start.attachmentId]))
    const result = await attachments.reapUnsentUploads()
    expect(result.removed).toBeGreaterThanOrEqual(2)
    expect(stored.deleted).toContain(forgotten.key)
    expect(stored.aborted).toContain(unfinished.key)
    expect(await db.select().from(files).where(inArray(files.r2Key, [forgotten.key, unfinished.key]))).toHaveLength(0)
    // Sent attachments are untouched
    const thread = await queries.listMessages(callers.labA.actor, ticketId, { limit: 50 })
    expect(thread.messages.flatMap((m) => m.attachments).length).toBeGreaterThanOrEqual(2)
  })
})
