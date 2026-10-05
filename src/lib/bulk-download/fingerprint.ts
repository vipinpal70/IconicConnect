import { createHash } from 'node:crypto'
import type { ZipEntryPlan } from './types'

export type DownloadState = 'never' | 'downloaded' | 'updated'

/**
 * One short, stable hash per file in a case's download. It covers the zip path, where the file lives and a
 * `version` (R2 ETag + last-modified, or a content hash for generated text). Because R2 keys are
 * `labName/fileName`, re-uploading a corrected design under the SAME name keeps the key — the version is
 * what makes that change visible.
 */
export function fileFingerprint(e: Pick<ZipEntryPlan, 'path' | 'source'> & { version?: string }): string {
  const where =
    e.source.kind === 'r2' ? `r2:${e.source.key}` : e.source.kind === 'http' ? `http:${e.source.url}` : 'text'
  return createHash('sha1').update(`${e.path}|${where}|${e.version ?? ''}`).digest('hex').slice(0, 16)
}

export function signatureOf(fingerprints: string[]): string {
  return createHash('sha256').update([...fingerprints].sort().join('\n')).digest('hex')
}

/**
 * never      — no completed download
 * downloaded — everything now available was already in the last completed download
 * updated    — something is new or replaced since (shrinking, e.g. retention-deleted files, is NOT an update)
 */
export function classifyDownload(current: string[], last: string[] | null | undefined): DownloadState {
  if (!last) return 'never'
  const seen = new Set(last)
  return current.some((fp) => !seen.has(fp)) ? 'updated' : 'downloaded'
}
