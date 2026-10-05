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
import { createHash } from 'node:crypto'
import { classifyDownload, fileFingerprint, signatureOf, type DownloadState } from './fingerprint'
import { claimCases, completeClaim, failClaim, getLatestCompleted } from './tracking'
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

/** `includeDownloaded` arrives as a JSON boolean (preview) or the string 'true' (form post). */
export function wantsIncludeDownloaded(fields: Record<string, unknown>): boolean {
  return fields.includeDownloaded === true || fields.includeDownloaded === 'true'
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

type InspectedEntry = ZipEntryPlan & { missing?: boolean; version?: string }

/** HEAD every R2 object: fills in sizes (outputFile has none in the DB) and flags missing objects. */
async function inspectEntries(entries: ZipEntryPlan[]): Promise<InspectedEntry[]> {
  const out: InspectedEntry[] = entries.map((e) => ({
    ...e,
    // generated text has no storage object — its version is a hash of the content
    version: e.source.kind === 'text' ? createHash('sha1').update(e.source.content).digest('hex').slice(0, 12) : undefined,
  }))
  let next = 0
  async function worker() {
    while (next < out.length) {
      const e = out[next++]
      if (e.source.kind !== 'r2') continue
      try {
        const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: e.source.key }))
        if (typeof head.ContentLength === 'number') e.size = head.ContentLength
        e.version = `${head.ETag ?? ''}|${head.LastModified?.getTime() ?? ''}|${head.ContentLength ?? ''}`
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

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export type CaseDownloadInfo = {
  state: DownloadState
  lastAt: string | null
  /** Staff scope only — a lab never sees who (or whether) staff downloaded its files. */
  lastBy: string | null
}

async function prepare(
  profile: AuthedProfile,
  scope: DownloadScope,
  caseIds: string[],
  include: InternalInclude,
  includeDownloaded: boolean,
) {
  const { cases: rows, skipped: accessSkipped } = await loadDownloadableCases(profile, scope, caseIds)
  const collected =
    scope === 'client_output'
      ? await collectClientOutputEntries(rows)
      : await collectInternalEntries(rows, include)
  const inspected = await inspectEntries(collected.entries)
  let usable = inspected.filter((e) => !e.missing)
  const missing = inspected.filter((e) => e.missing)

  // ── Already-downloaded tracking ───────────────────────────────────────────
  const latest = await getLatestCompleted(rows.map((r) => r.id), scope)
  const fingerprintsByCase = new Map<string, string[]>()
  const downloadInfo = new Map<string, CaseDownloadInfo>()
  const alreadyDownloaded: Array<{ caseId: string; caseNumber: string | null; lastAt: string; lastBy: string | null }> = []
  const dropped = new Set<string>()
  for (const c of rows) {
    const fps = usable.filter((e) => e.caseId === c.id).map((e) => fileFingerprint(e))
    fingerprintsByCase.set(c.id, fps)
    const last = latest.get(c.id)
    const state = fps.length === 0 ? (last ? 'downloaded' : 'never') : classifyDownload(fps, last?.fingerprints)
    const lastBy = scope === 'internal_files' ? (last?.downloadedByName ?? null) : null
    downloadInfo.set(c.id, { state, lastAt: last?.completedAt.toISOString() ?? null, lastBy })
    if (state === 'downloaded' && last && !includeDownloaded) {
      dropped.add(c.id)
      alreadyDownloaded.push({ caseId: c.id, caseNumber: c.caseNumber, lastAt: last.completedAt.toISOString(), lastBy })
    }
  }
  usable = usable.filter((e) => !dropped.has(e.caseId))

  const skipped: SkippedItem[] = [
    ...accessSkipped,
    ...collected.skipped.filter((s) => !s.caseId || !dropped.has(s.caseId)),
    ...missing.filter((e) => !dropped.has(e.caseId)).map((e) => ({
      caseId: e.caseId,
      caseNumber: e.caseNumber,
      reason: `${e.path}: file no longer available in storage`,
    })),
    ...alreadyDownloaded.map((a) => ({
      caseId: a.caseId,
      caseNumber: a.caseNumber,
      reason: `Already downloaded on ${fmtDate(new Date(a.lastAt))}${a.lastBy ? ` by ${a.lastBy}` : ''}`,
    })),
  ]
  const totalBytes = usable.reduce((n, e) => n + (e.size ?? 0), 0)
  return { rows, usable, skipped, totalBytes, downloadInfo, alreadyDownloaded, fingerprintsByCase }
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
  includeDownloaded = false,
) {
  const { rows, usable, skipped, totalBytes, downloadInfo, alreadyDownloaded } = await prepare(profile, scope, caseIds, include, includeDownloaded)
  const cases = rows.map((c) => {
    const mine = usable.filter((e) => e.caseId === c.id)
    return {
      caseId: c.id,
      caseNumber: c.caseNumber,
      files: mine.filter((e) => e.source.kind !== 'text').length,
      bytes: mine.reduce((n, e) => n + (e.size ?? 0), 0),
      download: downloadInfo.get(c.id) ?? { state: 'never' as DownloadState, lastAt: null, lastBy: null },
    }
  }).filter((c) => c.files > 0)
  return {
    cases,
    skipped,
    alreadyDownloaded,
    includeDownloaded,
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
  const res = await fetch(e.source.url, { redirect: 'error' })
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
  includeDownloaded = false,
): Promise<Response> {
  const prepared = await prepare(profile, scope, caseIds, include, includeDownloaded)
  const { rows, skipped, totalBytes, fingerprintsByCase } = prepared
  let usable = prepared.usable

  const reject = async (status: number, error: string, reason: string) => {
    await logActivity({
      actor: profile,
      action: 'bulk_download.rejected',
      details: auditDetails(scope, { reason, caseIds, totalBytes }),
    }).catch(() => {})
    return NextResponse.json({ error }, { status })
  }

  if (usable.filter((e) => e.source.kind !== 'text').length === 0) {
    if (prepared.alreadyDownloaded.length > 0) {
      return reject(409, 'All selected cases were already downloaded. Tick "Include cases I already downloaded" to download them again.', 'already_downloaded')
    }
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

  let involved = rows.filter((c) => usable.some((e) => e.caseId === c.id))

  // Claim every case; one that is already being downloaded elsewhere is skipped, not duplicated.
  const claims = await claimCases(
    profile,
    scope,
    involved.map((c) => ({ id: c.id, clientId: c.clientId })),
    scope === 'internal_files' ? include : null,
  ).catch((err) => {
    console.error('[BulkDownload] claim failed:', err)
    return new Map<string, string>()
  })
  const unclaimed = involved.filter((c) => !claims.has(c.id))
  for (const c of unclaimed) {
    skipped.push({ caseId: c.id, caseNumber: c.caseNumber, reason: 'A download of this case is already in progress' })
  }
  usable = usable.filter((e) => claims.has(e.caseId))
  involved = involved.filter((c) => claims.has(c.id))
  if (involved.length === 0) {
    await releaseDownloadSlot(profile.id)
    return reject(409, 'These cases are already being downloaded. Please wait for that download to finish.', 'in_progress')
  }
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
        downloadId: claims.get(c.id),
        files: usable.filter((e) => e.caseId === c.id && e.source.kind !== 'text').map((e) => e.path),
        ...(scope === 'internal_files' ? { include } : {}),
      }),
    ),
  )

  const archive = new ZipArchive({ store: true })
  const used = new Set<string>()
  const delivered = new Map<string, number>()
  const bytesDelivered = new Map<string, number>()
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
        bytesDelivered.set(e.caseId, (bytesDelivered.get(e.caseId) ?? 0) + (e.size ?? 0))
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
      // Persist tracking state: only a fully delivered case counts as "downloaded".
      await Promise.all(
        involved.map(async (c) => {
          const claimId = claims.get(c.id)!
          const caseFailures = failed.filter((f) => f.caseId === c.id)
          const files = delivered.get(c.id) ?? 0
          try {
            if (fatal || aborted) {
              await failClaim(claimId, fatal ?? 'client_aborted')
            } else if (caseFailures.length > 0 || files === 0) {
              await failClaim(claimId, caseFailures.length > 0 ? 'files_failed' : 'no_files_delivered')
            } else {
              const fps = fingerprintsByCase.get(c.id) ?? []
              await completeClaim(claimId, {
                caseId: c.id,
                clientId: c.clientId,
                scope,
                filesDelivered: files,
                bytesDelivered: bytesDelivered.get(c.id) ?? 0,
                signature: signatureOf(fps),
                fingerprints: fps,
              })
            }
          } catch (err) {
            console.error('[BulkDownload] tracking update failed:', err)
          }
        }),
      )
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
