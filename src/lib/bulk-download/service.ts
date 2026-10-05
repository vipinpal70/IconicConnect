import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { ZipArchive, type Archiver } from 'archiver'
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET } from '@/src/lib/r2'
import { logActivity } from '@/src/lib/activity-log'
import {
  loadDownloadableCases,
  type CaseRow,
} from './access'
import { collectClientOutputEntries, collectInternalEntries } from './collect'
import {
  MAX_TOTAL_BYTES,
  acquireDownloadSlot,
  refreshDownloadSlot,
  releaseDownloadSlot,
} from './limits'
import { sanitizeSegment, uniquePath } from './names'
import type {
  AuthedProfile,
  DownloadScope,
  InternalInclude,
  SkippedItem,
  ZipEntryPlan,
} from './types'

const HEAD_CONCURRENCY = 8

export const DEFAULT_INCLUDE: InternalInclude = {
  scan: true,
  reference: true,
  teethLibrary: true,
  outputs: false,
}

export function parseInclude(raw: unknown): InternalInclude {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof InternalInclude, unknown>>
  return {
    scan: r.scan === undefined ? DEFAULT_INCLUDE.scan : r.scan === true,
    reference: r.reference === undefined ? DEFAULT_INCLUDE.reference : r.reference === true,
    teethLibrary: r.teethLibrary === undefined ? DEFAULT_INCLUDE.teethLibrary : r.teethLibrary === true,
    outputs: r.outputs === true,
  }
}

type InspectedEntry = ZipEntryPlan & { missing?: boolean }

/** HEAD every R2 object: fills in sizes (outputFile has none in the DB) and flags missing objects. */
async function inspectEntries(entries: ZipEntryPlan[]): Promise<InspectedEntry[]> {
  const out: InspectedEntry[] = entries.map((e) => ({ ...e }))
  let next = 0
  async function worker() {
    while (next < out.length) {
      const e = out[next++]
      if (e.source.kind !== 'r2') continue
      try {
        const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: e.source.key }))
        if (typeof head.ContentLength === 'number') e.size = head.ContentLength
      } catch (err: unknown) {
        const meta = err as { name?: string; $metadata?: { httpStatusCode?: number } }
        if (meta?.name === 'NotFound' || meta?.name === 'NoSuchKey' || meta?.$metadata?.httpStatusCode === 404) {
          e.missing = true
        } else {
          console.error('[BulkDownload] HEAD failed:', e.source.key, err)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(HEAD_CONCURRENCY, out.length) }, worker))
  return out
}

async function prepare(
  profile: AuthedProfile,
  scope: DownloadScope,
  caseIds: string[],
  include: InternalInclude,
) {
  const { cases: rows, skipped: accessSkipped } = await loadDownloadableCases(profile, scope, caseIds)
  const collected =
    scope === 'client_output'
      ? await collectClientOutputEntries(rows)
      : await collectInternalEntries(rows, include)
  const inspected = await inspectEntries(collected.entries)
  const usable = inspected.filter((e) => !e.missing)
  const missing = inspected.filter((e) => e.missing)
  const skipped: SkippedItem[] = [
    ...accessSkipped,
    ...collected.skipped,
    ...missing.map((e) => ({
      caseId: e.caseId,
      caseNumber: e.caseNumber,
      reason: `${e.path}: file no longer available in storage`,
    })),
  ]
  const totalBytes = usable.reduce((n, e) => n + (e.size ?? 0), 0)
  return { rows, usable, skipped, totalBytes }
}

function auditDetails(scope: DownloadScope, extra: Record<string, unknown> = {}) {
  return { scope, ...extra }
}

/** Preflight for the dialog — nothing is streamed or logged as a download. */
export async function buildManifest(
  profile: AuthedProfile,
  scope: DownloadScope,
  caseIds: string[],
  include: InternalInclude,
) {
  const { rows, usable, skipped, totalBytes } = await prepare(profile, scope, caseIds, include)
  const cases = rows.map((c) => {
    const mine = usable.filter((e) => e.caseId === c.id)
    return {
      caseId: c.id,
      caseNumber: c.caseNumber,
      files: mine.filter((e) => e.source.kind !== 'text').length,
      bytes: mine.reduce((n, e) => n + (e.size ?? 0), 0),
    }
  }).filter((c) => c.files > 0)
  return {
    cases,
    skipped,
    totalFiles: cases.reduce((n, c) => n + c.files, 0),
    totalBytes,
    maxBytes: MAX_TOTAL_BYTES,
    overLimit: totalBytes > MAX_TOTAL_BYTES,
  }
}

/** Resolves when archiver finishes the entry. Also settles if the client aborts — archiver.abort() emits nothing. */
function waitForEntry(archive: Archiver, signal: AbortSignal, append: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('client_aborted'))
    const onEntry = () => { cleanup(); resolve() }
    const onError = (err: Error) => { cleanup(); reject(err) }
    const onClose = () => { cleanup(); reject(new Error('archive closed')) }
    const onAbort = () => { cleanup(); reject(new Error('client_aborted')) }
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      archive.off('entry', onEntry)
      archive.off('error', onError)
      archive.off('close', onClose)
    }
    archive.once('entry', onEntry)
    archive.once('error', onError)
    archive.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
    append()
  })
}

async function openSource(e: ZipEntryPlan): Promise<Readable | Buffer> {
  if (e.source.kind === 'text') return Buffer.from(e.source.content, 'utf8')
  if (e.source.kind === 'r2') {
    const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: e.source.key }))
    if (!obj.Body) throw new Error('empty body')
    return obj.Body as Readable
  }
  const res = await fetch(e.source.url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  return Readable.fromWeb(res.body as never)
}

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** Validate, then return a streaming ZIP response. Every step is written to the activity log. */
export async function streamDownload(
  req: Request,
  profile: AuthedProfile,
  scope: DownloadScope,
  caseIds: string[],
  include: InternalInclude,
): Promise<Response> {
  const { rows, usable, skipped, totalBytes } = await prepare(profile, scope, caseIds, include)

  const reject = async (status: number, error: string, reason: string) => {
    await logActivity({
      actor: profile,
      action: 'bulk_download.rejected',
      details: auditDetails(scope, { reason, caseIds, totalBytes }),
    }).catch(() => {})
    return NextResponse.json({ error }, { status })
  }

  if (usable.filter((e) => e.source.kind !== 'text').length === 0) {
    return reject(404, 'No downloadable files found for the selected cases', 'no_files')
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return reject(
      413,
      `Selection is too large (${(totalBytes / 1024 ** 3).toFixed(1)} GB). Maximum is ${(MAX_TOTAL_BYTES / 1024 ** 3).toFixed(0)} GB — select fewer cases.`,
      'too_large',
    )
  }
  if (!(await acquireDownloadSlot(profile.id))) {
    return reject(429, 'You already have downloads in progress. Please wait for one to finish.', 'concurrency')
  }

  const involved = rows.filter((c) => usable.some((e) => e.caseId === c.id))
  const caseLog = (c: CaseRow, action: string, details: Record<string, unknown>) =>
    logActivity({
      actor: profile,
      action,
      caseId: c.id,
      details: auditDetails(scope, { caseNumber: c.caseNumber, ...details }),
    }).catch((err) => console.error('[BulkDownload] activity log failed:', err))

  await Promise.all(
    involved.map((c) =>
      caseLog(c, 'case.bulk_download_started', {
        files: usable.filter((e) => e.caseId === c.id && e.source.kind !== 'text').map((e) => e.path),
        ...(scope === 'internal_files' ? { include } : {}),
      }),
    ),
  )

  const archive = new ZipArchive({ store: true })
  const used = new Set<string>()
  const delivered = new Map<string, number>()
  const failed: Array<{ caseId: string; path: string; error: string }> = []
  let aborted = false
  let current: Readable | null = null

  req.signal.addEventListener('abort', () => {
    aborted = true
    current?.destroy()
    archive.abort()
  })

  const run = (async () => {
    let fatal: string | null = null
    try {
      for (const e of usable) {
        if (aborted) break
        const zipPath = uniquePath(`${sanitizeSegment(e.caseNumber, 'case')}/${e.path}`, used)
        let body: Readable | Buffer
        try {
          body = await openSource(e)
        } catch (err) {
          failed.push({ caseId: e.caseId, path: e.path, error: err instanceof Error ? err.message : 'open failed' })
          continue
        }
        current = Buffer.isBuffer(body) ? null : body
        await waitForEntry(archive, req.signal, () => archive.append(body, { name: zipPath }))
        current = null
        void refreshDownloadSlot(profile.id)
        delivered.set(e.caseId, (delivered.get(e.caseId) ?? 0) + (e.source.kind === 'text' ? 0 : 1))
      }
      if (!aborted) {
        const lines = [
          `Iconic Connect bulk download — ${new Date().toISOString()}`,
          `Cases: ${involved.length} · Files: ${[...delivered.values()].reduce((a, b) => a + b, 0)}`,
          '',
          ...(skipped.length || failed.length ? ['Not included:'] : []),
          ...skipped.map((s) => `- ${s.caseNumber ?? s.caseId ?? 'unknown'}: ${s.reason}`),
          ...failed.map((f) => `- ${f.path}: failed to download (${f.error})`),
        ]
        archive.append(Buffer.from(lines.join('\n') + '\n', 'utf8'), { name: '_SUMMARY.txt' })
        await archive.finalize()
      }
    } catch (err) {
      if (aborted) {
        // client cancelled — expected, not an error
      } else {
        fatal = err instanceof Error ? err.message : 'Download failed'
        console.error('[BulkDownload] stream failed:', err)
      }
      archive.abort()
    } finally {
      await releaseDownloadSlot(profile.id)
      await Promise.all(
        involved.map((c) =>
          fatal || aborted
            ? caseLog(c, 'case.bulk_download_failed', {
                reason: fatal ?? 'client_aborted',
                filesDelivered: delivered.get(c.id) ?? 0,
              })
            : caseLog(c, 'case.bulk_download_completed', {
                filesDelivered: delivered.get(c.id) ?? 0,
                failed: failed.filter((f) => f.caseId === c.id).map((f) => f.path),
                skipped: skipped.filter((s) => s.caseId === c.id).map((s) => s.reason),
              }),
        ),
      )
    }
  })()
  void run

  const filename = `IconicConnect-${scope === 'client_output' ? 'outputs' : 'case-files'}-${stamp()}.zip`
  return new Response(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
