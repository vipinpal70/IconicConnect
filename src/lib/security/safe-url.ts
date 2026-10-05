import { keyFromProxyUrl } from '@/src/lib/r2-objects'

/**
 * Stored file URLs are rendered into <a href>/<iframe src>/<img src> and (for bulk download)
 * fetched server-side, so a client-supplied value must never be trusted as-is.
 *
 * Accepted:
 *   1. Our auth-gated proxy URL:  /api/cases/files?labName=…&fileName=…
 *      (optionally pinned to the expected lab so one lab can't point at another lab's objects)
 *   2. Our own Supabase Storage public URL (legacy uploads)
 * Everything else (javascript:, data:, other hosts, internal addresses) is rejected.
 */
export function supabaseStorageHost(): string | null {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null
  } catch {
    return null
  }
}

export function isOurSupabaseStorageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = supabaseStorageHost()
    return u.protocol === 'https:' && !!host && u.host === host && u.pathname.startsWith('/storage/v1/object/')
  } catch {
    return false
  }
}

export function isSafeStoredFileUrl(url: unknown, opts: { expectedLabName?: string } = {}): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return false
  if (url.startsWith('/')) {
    const key = keyFromProxyUrl(url)
    if (!key) return false
    if (opts.expectedLabName !== undefined) {
      const labName = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('labName')
      if (labName !== opts.expectedLabName) return false
    }
    return true
  }
  return isOurSupabaseStorageUrl(url)
}
