/** Make one path segment safe for a ZIP entry (no traversal, no reserved chars). */
export function sanitizeSegment(raw: string, fallback = 'file'): string {
  let s = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  s = s.replace(/^\.+/, '')
  if (s.length > 150) {
    const dot = s.lastIndexOf('.')
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : ''
    s = s.slice(0, 150 - ext.length) + ext
  }
  return s || fallback
}

/** Returns a path unique within `used` (case-insensitive), adding ` (n)` before the extension. */
export function uniquePath(path: string, used: Set<string>): string {
  let candidate = path
  let n = 1
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  const hasExt = dot > slash + 1
  const stem = hasExt ? path.slice(0, dot) : path
  const ext = hasExt ? path.slice(dot) : ''
  while (used.has(candidate.toLowerCase())) {
    n += 1
    candidate = `${stem} (${n})${ext}`
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/** File name from a stored proxy/absolute URL when no name column exists. */
export function fileNameFromUrl(url: string): string {
  try {
    const q = url.indexOf('?')
    if (q !== -1) {
      const name = new URLSearchParams(url.slice(q + 1)).get('fileName')
      if (name) return name
    }
    const last = decodeURIComponent(url.split('?')[0]).split('/').pop()
    return last || 'file'
  } catch {
    return 'file'
  }
}
