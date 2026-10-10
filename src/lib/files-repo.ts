import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { files, type FileKind, type FileRow } from '@/src/db/schema/files'
import { keyFromProxyUrl } from '@/src/lib/r2-objects'

/**
 * Single access point for the `files` registry (replaces case_files / case_preview_files /
 * case_reference_files / case_hold_files and the inline output/preview/teeth-library columns).
 * Every read filters by `kind`, so previews / reference / hold images can never leak into "Case Files".
 * Responses keep the legacy shape ({ fileUrl, fileType, fileSize }) so the UI contract is unchanged.
 */

// Retention: every R2 object is deleted 3 months after upload (design decision 6).
const RETENTION_MONTHS = 3

type Db = Pick<typeof db, 'select' | 'insert' | 'delete'>

/** r2_key -> the proxy URL the frontend already understands (`${labName}/${fileName}`). */
export function toProxyUrl(r2Key: string): string {
  if (/^https?:\/\//i.test(r2Key)) return r2Key // legacy absolute URL kept verbatim as its own key
  const i = r2Key.indexOf('/')
  if (i < 0) return r2Key
  return `/api/cases/files?labName=${encodeURIComponent(r2Key.slice(0, i))}&fileName=${encodeURIComponent(r2Key.slice(i + 1))}`
}

/** Stored/submitted URL -> r2_key (proxy URLs map to their R2 key; other absolute URLs are their own key). */
export const keyFromUrl = (url: string): string => keyFromProxyUrl(url) ?? url

export type LegacyFile = {
  id: string
  caseId: string | null
  uploadedBy: string | null
  fileName: string
  fileUrl: string
  note: string | null
  fileType: string | null
  fileSize: number | null
  createdAt: Date
  /** true once the retention job removed the R2 object — UI shows "expired" instead of a broken link */
  purged: boolean
}

export const toLegacy = (r: FileRow): LegacyFile => ({
  id: r.id,
  caseId: r.caseId,
  uploadedBy: r.uploadedBy,
  fileName: r.fileName,
  fileUrl: toProxyUrl(r.r2Key),
  note: r.note,
  fileType: r.contentType,
  fileSize: r.sizeBytes,
  createdAt: r.createdAt,
  purged: r.status === 'purged',
})

const live = (kind: FileKind | FileKind[]) =>
  and(Array.isArray(kind) ? inArray(files.kind, kind) : eq(files.kind, kind), isNull(files.deletedAt))

export async function listByCases(caseIds: string[], kind: FileKind, d: Db = db): Promise<LegacyFile[]> {
  if (!caseIds.length) return []
  const rows = await d.select().from(files)
    .where(and(inArray(files.caseId, caseIds), live(kind)))
    .orderBy(asc(files.createdAt))
  return rows.map(toLegacy)
}
export const listByCase = (caseId: string, kind: FileKind, d: Db = db) => listByCases([caseId], kind, d)

/** One file per case: the earliest (`first`) or latest upload of that kind. */
export async function pickPerCase(caseIds: string[], kind: FileKind, which: 'first' | 'latest'): Promise<Map<string, LegacyFile>> {
  if (!caseIds.length) return new Map()
  const rows = await db.selectDistinctOn([files.caseId]).from(files)
    .where(and(inArray(files.caseId, caseIds), live(kind)))
    .orderBy(files.caseId, which === 'first' ? asc(files.createdAt) : desc(files.createdAt))
  return new Map(rows.map((r) => [r.caseId!, toLegacy(r)]))
}

export type NewLegacyFile = {
  clientId: string
  caseId: string | null
  kind: FileKind
  uploadedBy: string | null
  fileName: string
  fileUrl: string
  fileType?: string | null
  fileSize?: number | null
  note?: string | null
  messageId?: string | null
}

export async function insertFiles(rows: NewLegacyFile[], d: Db = db): Promise<LegacyFile[]> {
  if (!rows.length) return []
  const now = new Date()
  const purgeAfter = new Date(now); purgeAfter.setMonth(purgeAfter.getMonth() + RETENTION_MONTHS)
  const inserted = await d.insert(files).values(rows.map((r) => ({
    clientId: r.clientId,
    caseId: r.caseId,
    messageId: r.messageId ?? null,
    kind: r.kind,
    uploadedBy: r.uploadedBy,
    fileName: r.fileName.slice(0, 255),
    r2Key: keyFromUrl(r.fileUrl),
    contentType: r.fileType ?? null,
    sizeBytes: r.fileSize ?? null,
    note: r.note ?? null,
    status: 'ready' as const,
    readyAt: now,
    purgeAfter,
  }))).onConflictDoNothing().returning() // uq_files_key_kind_owner
  return inserted.map(toLegacy)
}

export async function deleteOne(id: string, caseId: string, kind: FileKind): Promise<LegacyFile | null> {
  const [row] = await db.delete(files)
    .where(and(eq(files.id, id), eq(files.caseId, caseId), eq(files.kind, kind))).returning()
  return row ? toLegacy(row) : null
}

export async function deleteByCases(caseIds: string[], d: Db = db): Promise<void> {
  if (caseIds.length) await d.delete(files).where(inArray(files.caseId, caseIds))
}

/** Case ids that already hold a (non-deleted) file of `kind` whose name matches — duplicate-upload check. */
export async function caseIdsWithFileName(clientId: string, names: string[]): Promise<Array<{ caseId: string | null; fileName: string }>> {
  if (!names.length) return []
  return db.select({ caseId: files.caseId, fileName: files.fileName }).from(files)
    .where(and(eq(files.clientId, clientId), eq(files.kind, 'scan'), isNull(files.deletedAt),
      inArray(sql`lower(${files.fileName})`, names.map((n) => n.toLowerCase()))))
}
