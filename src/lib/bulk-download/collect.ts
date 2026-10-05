import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { db } from '@/src/db'
import {
  caseFiles,
  casePreviewFiles,
  caseReferenceFiles,
} from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { keyFromProxyUrl } from '@/src/lib/r2-objects'
import { fileNameFromUrl, sanitizeSegment } from './names'
import type { CaseRow } from './access'
import type { InternalInclude, SkippedItem, SourceRef, ZipEntryPlan } from './types'

// Uploaders whose case_files are NOT "client/lab" files: design-side notes/attachments
// and milling-centre production photos. Admin is kept — admins create cases on behalf of clients.
const NON_LAB_UPLOADER_ROLES = [
  'designer', 'qc', 'milling_admin', 'milling_production', 'milling_support',
] as const

/** Stored URL → source. Proxy URL → R2 key; absolute URL (legacy Supabase) → http; else null. */
export function resolveSource(url: string | null | undefined): SourceRef | null {
  if (!url) return null
  const key = keyFromProxyUrl(url)
  if (key) return { kind: 'r2', key }
  if (/^https?:\/\//i.test(url)) return { kind: 'http', url }
  return null
}

type Collector = {
  entries: ZipEntryPlan[]
  skipped: SkippedItem[]
  add: (c: CaseRow, folder: string, fileName: string, url: string | null | undefined, size: number | null) => void
}

function makeCollector(): Collector {
  const entries: ZipEntryPlan[] = []
  const skipped: SkippedItem[] = []
  return {
    entries,
    skipped,
    add(c, folder, fileName, url, size) {
      const source = resolveSource(url)
      if (!source) {
        skipped.push({ caseId: c.id, caseNumber: c.caseNumber, reason: `${fileName}: unsupported or missing file location` })
        return
      }
      entries.push({
        caseId: c.id,
        caseNumber: c.caseNumber ?? c.id,
        path: `${folder}${sanitizeSegment(fileName)}`,
        source,
        size,
      })
    },
  }
}

async function addOutputs(col: Collector, rows: CaseRow[], outputFolder: string, previewFolder: string) {
  const previews = await db
    .select()
    .from(casePreviewFiles)
    .where(inArray(casePreviewFiles.caseId, rows.map((r) => r.id)))
    .orderBy(asc(casePreviewFiles.createdAt))
  for (const c of rows) {
    const casePreviews = previews.filter((x) => x.caseId === c.id)
    if (c.outputFile) col.add(c, outputFolder, fileNameFromUrl(c.outputFile), c.outputFile, null)
    if (c.outputNote?.trim()) {
      col.entries.push({
        caseId: c.id,
        caseNumber: c.caseNumber ?? c.id,
        path: `${outputFolder}output-note.txt`,
        source: { kind: 'text', content: c.outputNote.trim() + '\n' },
        size: Buffer.byteLength(c.outputNote),
      })
    }
    for (const p of casePreviews) col.add(c, previewFolder, p.fileName, p.fileUrl, p.fileSize ?? null)
  }
}

/** Client download: design output + previews (+ note) per case. */
export async function collectClientOutputEntries(rows: CaseRow[]) {
  const col = makeCollector()
  if (rows.length) await addOutputs(col, rows, '', 'preview/')
  for (const c of rows) {
    if (!col.entries.some((e) => e.caseId === c.id)) {
      col.skipped.push({ caseId: c.id, caseNumber: c.caseNumber, reason: 'No output or preview files uploaded' })
    }
  }
  return { entries: col.entries, skipped: col.skipped }
}

/** Internal download: the client/lab's uploads, optionally plus design outputs. */
export async function collectInternalEntries(rows: CaseRow[], include: InternalInclude) {
  const col = makeCollector()
  if (!rows.length) return { entries: col.entries, skipped: col.skipped }
  const ids = rows.map((r) => r.id)

  const [scanFiles, refFiles] = await Promise.all([
    include.scan
      ? db
          .select({
            caseId: caseFiles.caseId,
            fileName: caseFiles.fileName,
            fileUrl: caseFiles.fileUrl,
            fileSize: caseFiles.fileSize,
          })
          .from(caseFiles)
          .innerJoin(profiles, eq(caseFiles.uploadedBy, profiles.id))
          .where(and(inArray(caseFiles.caseId, ids), notInArray(profiles.role, [...NON_LAB_UPLOADER_ROLES])))
          .orderBy(asc(caseFiles.createdAt))
      : Promise.resolve([]),
    include.reference
      ? db
          .select()
          .from(caseReferenceFiles)
          .where(inArray(caseReferenceFiles.caseId, ids))
          .orderBy(asc(caseReferenceFiles.createdAt))
      : Promise.resolve([]),
  ])

  for (const c of rows) {
    for (const f of scanFiles.filter((x) => x.caseId === c.id)) {
      col.add(c, 'scan/', f.fileName, f.fileUrl, f.fileSize ?? null)
    }
    for (const f of refFiles.filter((x) => x.caseId === c.id)) {
      col.add(c, 'reference/', f.fileName, f.fileUrl, f.fileSize ?? null)
    }
    if (include.teethLibrary && c.teethLibraryFileUrl) {
      col.add(c, 'teeth-library/', c.teethLibraryFileName || fileNameFromUrl(c.teethLibraryFileUrl), c.teethLibraryFileUrl, null)
    }
  }

  if (include.outputs) await addOutputs(col, rows, 'output/', 'preview/')

  for (const c of rows) {
    if (!col.entries.some((e) => e.caseId === c.id)) {
      col.skipped.push({ caseId: c.id, caseNumber: c.caseNumber, reason: 'No matching files' })
    }
  }
  return { entries: col.entries, skipped: col.skipped }
}
