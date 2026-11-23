import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { db } from '@/src/db'
import { files } from '@/src/db/schema/files'
import { supAttachments, supMessages, supTickets } from '@/src/db/schema/support'
import { r2, R2_BUCKET } from '@/src/lib/r2'
import { SupportError, notFound } from './http'
import { canViewTicket, checkPost, isAgent, isCustomer, type SupportActor } from './policy'
import type { AttachmentView, UploadStart } from './types'
import { MAX_ATTACHMENT_BYTES, UPLOAD_PART_BYTES, checkUpload, storageSafeName } from './upload-policy'

/**
 * Support attachments (support-system.md §8). Files go browser → R2 directly (multipart, presigned
 * parts); this module only authorises, records and verifies. Every object is registered in `files`
 * (kind 'support') so the orphan sweep keeps it and the retention job marks it purged.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const PART_URL_TTL_SECONDS = 6 * 60 * 60
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60
/** Uploads not sent within this time are removed by the reaper. */
export const UNSENT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

function partCount(sizeBytes: number) {
  return Math.max(1, Math.ceil(sizeBytes / UPLOAD_PART_BYTES))
}

async function signParts(key: string, uploadId: string, count: number) {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      getSignedUrl(r2, new UploadPartCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId, PartNumber: i + 1 }), {
        expiresIn: PART_URL_TTL_SECONDS,
      }).then((url) => ({ partNumber: i + 1, url })),
    ),
  )
}

/** The caller's own unsent upload, with its file row. */
async function ownPendingUpload(actor: SupportActor, attachmentId: string) {
  const [row] = await db
    .select({ attachment: supAttachments, file: files })
    .from(supAttachments)
    .innerJoin(files, eq(files.id, supAttachments.fileId))
    .where(and(eq(supAttachments.id, attachmentId), eq(supAttachments.uploadedBy, actor.id), isNull(supAttachments.messageId)))
    .limit(1)
  if (!row) throw new SupportError(404, 'upload_not_found', 'Upload not found')
  return row
}

// ── Start / continue / finish / cancel an upload ──────────────────────────────────────────────────

export async function startUpload(
  actor: SupportActor,
  input: { fileName: string; fileSize: number; ticketId?: string },
  now = new Date(),
): Promise<UploadStart> {
  const check = checkUpload(input.fileName, input.fileSize)
  if (!check.ok) throw new SupportError(400, 'file_not_allowed', check.reason)

  let clientId: string
  if (input.ticketId) {
    const [ticket] = await db
      .select({ clientId: supTickets.clientId, status: supTickets.status, closedAt: supTickets.closedAt, assigneeId: supTickets.assigneeId })
      .from(supTickets)
      .where(eq(supTickets.id, input.ticketId))
      .limit(1)
    if (!ticket || !canViewTicket(actor, ticket)) throw notFound()
    // Same rule as sending: no point uploading into a conversation the caller can't post to
    const post = checkPost(actor, ticket, isAgent(actor) ? 'note' : 'public', now)
    if (!post.ok) throw new SupportError(409, 'closed', 'This conversation is closed. Start a new conversation to continue.')
    clientId = ticket.clientId
  } else {
    // Attachments for a new conversation: customers only (an agent picks the lab first, then attaches in the thread)
    if (!isCustomer(actor)) throw new SupportError(400, 'ticket_required', 'Open the conversation first, then attach files')
    clientId = actor.clientId!
  }

  const uploadKey = crypto.randomUUID()
  const key = `support/${clientId}/${input.ticketId ?? 'new'}/${uploadKey}/${storageSafeName(input.fileName)}`
  const created = await r2.send(new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, ContentType: check.contentType }))
  if (!created.UploadId) throw new Error('R2 did not return an upload id')

  const attachmentId = await db.transaction(async (tx) => {
    const [file] = await tx
      .insert(files)
      .values({
        clientId,
        kind: 'support',
        uploadedBy: actor.id,
        fileName: input.fileName,
        r2Key: key,
        contentType: check.contentType,
        sizeBytes: input.fileSize,
        status: 'pending',
        uploadId: created.UploadId,
        supportTicketId: input.ticketId ?? null,
      })
      .returning({ id: files.id })
    const [attachment] = await tx
      .insert(supAttachments)
      .values({ fileId: file.id, clientId, ticketId: input.ticketId ?? null, uploadedBy: actor.id, kind: check.kind })
      .returning({ id: supAttachments.id })
    return attachment.id
  })

  return { attachmentId, partSize: UPLOAD_PART_BYTES, parts: await signParts(key, created.UploadId, partCount(input.fileSize)) }
}

/** Fresh part URLs (e.g. a very slow upload outlived the first ones). */
export async function resignUpload(actor: SupportActor, attachmentId: string): Promise<UploadStart> {
  const { file } = await ownPendingUpload(actor, attachmentId)
  if (file.status !== 'pending' || !file.uploadId) throw new SupportError(409, 'upload_finished', 'This upload has already finished')
  return { attachmentId, partSize: UPLOAD_PART_BYTES, parts: await signParts(file.r2Key, file.uploadId, partCount(file.sizeBytes ?? 1)) }
}

export async function completeUpload(
  actor: SupportActor,
  attachmentId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<AttachmentView> {
  const { attachment, file } = await ownPendingUpload(actor, attachmentId)
  if (file.status !== 'pending' || !file.uploadId) throw new SupportError(409, 'upload_finished', 'This upload has already finished')
  const expected = partCount(file.sizeBytes ?? 1)
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  if (sorted.length !== expected || sorted.some((p, i) => p.partNumber !== i + 1)) {
    throw new SupportError(400, 'invalid_parts', 'Upload is incomplete. Please try again.')
  }

  await r2.send(
    new CompleteMultipartUploadCommand({
      Bucket: R2_BUCKET,
      Key: file.r2Key,
      UploadId: file.uploadId,
      MultipartUpload: { Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  )

  // Never trust the declared size: check what was actually stored
  const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: file.r2Key }))
  const actualSize = Number(head.ContentLength ?? 0)
  if (actualSize <= 0 || actualSize > MAX_ATTACHMENT_BYTES || actualSize !== file.sizeBytes) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: file.r2Key })).catch(() => {})
    await db.update(files).set({ status: 'failed', uploadId: null }).where(eq(files.id, file.id))
    throw new SupportError(400, 'size_mismatch', 'The uploaded file does not match what was expected. Please try again.')
  }

  await db.update(files).set({ status: 'ready', readyAt: new Date(), uploadId: null, sizeBytes: actualSize }).where(eq(files.id, file.id))
  return {
    id: attachment.id,
    kind: attachment.kind,
    fileName: file.fileName,
    contentType: file.contentType ?? 'application/octet-stream',
    sizeBytes: actualSize,
    status: 'ready',
  }
}

export async function abortUpload(actor: SupportActor, attachmentId: string) {
  const { file } = await ownPendingUpload(actor, attachmentId)
  if (file.status === 'pending' && file.uploadId) {
    await r2.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: file.r2Key, UploadId: file.uploadId })).catch(() => {})
  } else if (file.status === 'ready') {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: file.r2Key })).catch(() => {})
  }
  // Deleting the file row removes the attachment row (cascade)
  await db.delete(files).where(eq(files.id, file.id))
}

// ── Binding to a message (inside the send transaction) ────────────────────────────────────────────

/**
 * Attaches the caller's finished uploads to a message. Every id must be the caller's own, finished,
 * unsent upload for this conversation (or for this lab's new conversation). Anything else is rejected
 * without revealing whether the id exists.
 */
export async function bindAttachmentsTx(
  tx: Tx,
  ids: string[],
  ctx: { actorId: string; ticketId: string; clientId: string; messageId: string },
) {
  if (ids.length === 0) return
  const unique = [...new Set(ids)]
  const rows = await tx
    .select({ id: supAttachments.id, fileId: supAttachments.fileId, ticketId: supAttachments.ticketId, clientId: supAttachments.clientId, status: files.status })
    .from(supAttachments)
    .innerJoin(files, eq(files.id, supAttachments.fileId))
    .where(and(inArray(supAttachments.id, unique), eq(supAttachments.uploadedBy, ctx.actorId), isNull(supAttachments.messageId)))
    .for('update')
  const usable = rows.filter(
    (r) => r.status === 'ready' && r.clientId === ctx.clientId && (r.ticketId === ctx.ticketId || r.ticketId === null),
  )
  if (usable.length !== unique.length) {
    throw new SupportError(400, 'invalid_attachments', 'Some attachments are still uploading or no longer available. Remove them and try again.')
  }
  await tx
    .update(supAttachments)
    .set({ messageId: ctx.messageId, ticketId: ctx.ticketId })
    .where(inArray(supAttachments.id, unique))
  await tx
    .update(files)
    .set({ supportTicketId: ctx.ticketId })
    .where(inArray(files.id, usable.map((r) => r.fileId)))
}

/** Attachments of the given messages, in upload order. */
export async function attachmentsForMessages(messageIds: string[]): Promise<Map<string, AttachmentView[]>> {
  const result = new Map<string, AttachmentView[]>()
  if (messageIds.length === 0) return result
  const rows = await db
    .select({
      id: supAttachments.id,
      messageId: supAttachments.messageId,
      kind: supAttachments.kind,
      fileName: files.fileName,
      contentType: files.contentType,
      sizeBytes: files.sizeBytes,
      status: files.status,
    })
    .from(supAttachments)
    .innerJoin(files, eq(files.id, supAttachments.fileId))
    .where(inArray(supAttachments.messageId, messageIds))
    .orderBy(supAttachments.createdAt)
  for (const r of rows) {
    const list = result.get(r.messageId!) ?? []
    list.push({
      id: r.id,
      kind: r.kind,
      fileName: r.fileName,
      contentType: r.contentType ?? 'application/octet-stream',
      sizeBytes: r.sizeBytes ?? 0,
      status: r.status === 'purged' ? 'expired' : 'ready',
    })
    result.set(r.messageId!, list)
  }
  return result
}

// ── Viewing / downloading ─────────────────────────────────────────────────────────────────────────

/**
 * A short-lived signed R2 URL for an attachment the caller may see. R2 honours HTTP Range requests on
 * it, so videos stream and seek without downloading the whole file. Customers never get files attached
 * to internal notes.
 */
export async function attachmentUrl(actor: SupportActor, attachmentId: string, download: boolean): Promise<string> {
  const [row] = await db
    .select({
      uploadedBy: supAttachments.uploadedBy,
      messageId: supAttachments.messageId,
      messageKind: supMessages.kind,
      ticketClientId: supTickets.clientId,
      attachmentClientId: supAttachments.clientId,
      file: files,
    })
    .from(supAttachments)
    .innerJoin(files, eq(files.id, supAttachments.fileId))
    .leftJoin(supMessages, eq(supMessages.id, supAttachments.messageId))
    .leftJoin(supTickets, eq(supTickets.id, supAttachments.ticketId))
    .where(eq(supAttachments.id, attachmentId))
    .limit(1)
  if (!row) throw notFound()

  const sent = row.messageId !== null
  const visible = sent
    ? canViewTicket(actor, { clientId: row.ticketClientId ?? row.attachmentClientId }) && (row.messageKind !== 'note' || isAgent(actor))
    : row.uploadedBy === actor.id // your own preview before sending
  if (!visible) throw notFound()

  if (row.file.status === 'purged') throw new SupportError(410, 'expired', 'This file was removed after the 3-month storage period')
  if (row.file.status !== 'ready') throw notFound()

  const disposition = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.file.fileName)}`
  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: row.file.r2Key,
      ResponseContentType: row.file.contentType ?? 'application/octet-stream',
      ResponseContentDisposition: disposition,
      ResponseCacheControl: 'private, max-age=600',
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  )
}

// ── Reaper (maintenance job) ──────────────────────────────────────────────────────────────────────

/**
 * Removes uploads that were never sent within 24 h (abandoned tabs, closed dialogs, failed uploads):
 * aborts unfinished multipart uploads, deletes finished-but-unsent objects, and drops their rows.
 */
export async function reapUnsentUploads(now = new Date()): Promise<{ removed: number }> {
  const cutoff = new Date(now.getTime() - UNSENT_UPLOAD_TTL_MS)
  const stale = await db
    .select({ fileId: files.id, key: files.r2Key, status: files.status, uploadId: files.uploadId })
    .from(supAttachments)
    .innerJoin(files, eq(files.id, supAttachments.fileId))
    .where(and(isNull(supAttachments.messageId), lt(supAttachments.createdAt, cutoff)))
    .limit(500)
  // Also failed rows that lost their attachment link
  const failed = await db
    .select({ fileId: files.id, key: files.r2Key, status: files.status, uploadId: files.uploadId })
    .from(files)
    .where(and(eq(files.kind, 'support'), eq(files.status, 'failed'), lt(files.createdAt, cutoff)))
    .limit(500)

  const all = [...stale, ...failed.filter((f) => !stale.some((s) => s.fileId === f.fileId))]
  for (const item of all) {
    if (item.status === 'pending' && item.uploadId) {
      await r2.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: item.key, UploadId: item.uploadId })).catch(() => {})
    } else if (item.status === 'ready' || item.status === 'failed') {
      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: item.key })).catch(() => {})
    }
  }
  // Deleting the file rows removes their attachment rows (cascade)
  if (all.length > 0) await db.delete(files).where(inArray(files.id, all.map((a) => a.fileId)))
  return { removed: all.length }
}
