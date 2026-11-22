import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
// Large full-arch STL exports reach ~320 MB (6–7 M triangles). They load through the low-memory
// binary STL welder and get a simplified display copy (see model-pipeline.ts).
const MAX_MESH_FILE_BYTES = 400 * 1024 * 1024
const MAX_TOTAL_MESH_BYTES = 512 * 1024 * 1024
const MAX_MESH_FILES = 48

/** Which preview a model is opened for; decides what part of an archive is shown. */
export type ModelPurpose = 'case-submission' | 'design-output'

/**
 * scan  – 3Shape DCM in a Scans/ folder (intraoral or model scans)
 * cad   – 3Shape DCM in a CAD/ folder (designed restorations)
 * mesh  – STL / PLY / OBJ anywhere (exocad and most CAD exports)
 * other – DCM outside those folders (libraries, misc); used only when nothing else exists
 */
export type MeshCategory = 'scan' | 'cad' | 'mesh' | 'other'

export interface ArchiveEntry {
  name: string
  category: MeshCategory
  /** Null when the file was skipped (see skipReason); the rest of the archive still opens. */
  bytes: Uint8Array | null
  /** Uncompressed size from the ZIP directory (or the extracted size). */
  byteSize: number
  skipReason?: string
}

export interface ScanArchiveProgress {
  loadedBytes: number
  totalBytes: number | null
}

const SCAN_FOLDERS = new Set(['scans', 'scan'])
/** 3Shape keeps superseded copies of the scans in Backup/, often in another coordinate frame. */
const IGNORED_FOLDERS = new Set(['backup', '__macosx'])
const CAD_FOLDERS = new Set(['cad'])
const MESH_EXTENSIONS = new Set(['stl', 'ply', 'obj'])

export function fileExtension(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function classifyArchiveEntry(name: string): MeshCategory | null {
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean)
  const baseName = parts[parts.length - 1]
  if (!baseName || baseName.startsWith('.')) return null

  const ext = fileExtension(baseName)
  const folders = parts.slice(0, -1).map((p) => p.toLowerCase())
  if (folders.some((f) => IGNORED_FOLDERS.has(f))) return null
  if (ext === 'dcm') {
    if (folders.some((f) => SCAN_FOLDERS.has(f))) return 'scan'
    if (folders.some((f) => CAD_FOLDERS.has(f))) return 'cad'
    return 'other'
  }
  return MESH_EXTENSIONS.has(ext) ? 'mesh' : null
}

/**
 * Case submissions show the lab's scans (falling back to whatever meshes exist).
 * Design outputs show the designed restoration together with the scans it sits on,
 * so reviewers see the design in context.
 */
export function selectEntries<T extends { category: MeshCategory }>(entries: T[], purpose: ModelPurpose): T[] {
  const of = (c: MeshCategory) => entries.filter((e) => e.category === c)
  const scans = of('scan')
  const design = [...of('cad'), ...of('mesh')]
  const other = of('other')

  if (purpose === 'design-output') {
    if (design.length > 0) return [...scans, ...design]
    return scans.length > 0 ? scans : other
  }
  if (scans.length > 0) return scans
  if (design.length > 0) return design
  return other
}

function sizeError(maxBytes: number): Error {
  return new Error(`3D file is larger than the viewer limit of ${Math.round(maxBytes / 1024 / 1024)} MB.`)
}

export async function fetchFileResponse(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('This 3D file is no longer available. Ask an administrator to upload it again.')
    }
    throw new Error(`Could not load 3D file (HTTP ${response.status}).`)
  }
  return response
}

function contentLengthOf(response: Response): number | null {
  const header = response.headers.get('content-length')
  const value = header ? Number(header) : Number.NaN
  return Number.isFinite(value) ? value : null
}

/** Read a whole (non-archive) model file, reporting download progress. */
export async function readResponse(
  response: Response,
  maxBytes: number,
  onProgress?: (progress: ScanArchiveProgress) => void,
): Promise<Uint8Array> {
  const totalBytes = contentLengthOf(response)
  if (totalBytes !== null && totalBytes > maxBytes) throw sizeError(maxBytes)

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw sizeError(maxBytes)
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      loadedBytes += value.byteLength
      if (loadedBytes > maxBytes) {
        await reader.cancel()
        throw sizeError(maxBytes)
      }
      chunks.push(value)
      onProgress?.({ loadedBytes, totalBytes })
    }
  } finally {
    reader.releaseLock()
  }
  return concat(chunks, loadedBytes)
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Standalone model files use the same per-file cap as meshes inside archives. */
export const MAX_SINGLE_FILE_BYTES = MAX_MESH_FILE_BYTES

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

/**
 * Stream-unzip an archive in a single pass, keeping every mesh-like entry with its category.
 * Unlike a two-pass "scans first, then CAD" approach, the archive is only downloaded once.
 *
 * A file that is too large, over the total budget or unreadable comes back with `bytes: null` and a
 * `skipReason` instead of failing the whole archive, so the rest of the case still opens.
 */
export async function extractMeshEntries(
  response: Response,
  onProgress?: (progress: ScanArchiveProgress) => void,
): Promise<ArchiveEntry[]> {
  const contentLength = contentLengthOf(response)
  if (contentLength !== null && contentLength > MAX_ARCHIVE_BYTES) throw sizeError(MAX_ARCHIVE_BYTES)
  if (!response.body) {
    throw new Error('The browser cannot stream this 3D archive.')
  }

  const entries: ArchiveEntry[] = []
  let totalMeshBytes = 0
  let meshCount = 0
  const overBudget = `Not loaded: the archive holds more than ${mb(MAX_TOTAL_MESH_BYTES)} of 3D data`
  const tooLarge = (size?: number) =>
    `Too large to preview (${size ? `${mb(size)}; ` : ''}limit ${mb(MAX_MESH_FILE_BYTES)})`

  const unzip = new Unzip((file) => {
    const category = classifyArchiveEntry(file.name)
    if (!category) return
    const declaredSize = typeof file.originalSize === 'number' ? file.originalSize : null
    // Unstarted files are skipped by the unzipper without inflating them
    const skip = (skipReason: string, byteSize = declaredSize ?? 0) =>
      entries.push({ name: file.name, category, bytes: null, byteSize, skipReason })

    if (declaredSize !== null && declaredSize > MAX_MESH_FILE_BYTES) return skip(tooLarge(declaredSize))
    if (meshCount >= MAX_MESH_FILES) return skip(`Not loaded: the archive has more than ${MAX_MESH_FILES} 3D files`)
    if (declaredSize !== null && totalMeshBytes + declaredSize > MAX_TOTAL_MESH_BYTES) return skip(overBudget)
    meshCount += 1
    // Reserve the declared size up front so later files are judged against the real budget
    if (declaredSize !== null) totalMeshBytes += declaredSize

    const chunks: Uint8Array[] = []
    let fileBytes = 0
    let failed = false
    const fail = (reason: string) => {
      failed = true
      chunks.length = 0
      totalMeshBytes -= declaredSize ?? fileBytes
      skip(reason, declaredSize ?? fileBytes)
    }
    file.ondata = (error, chunk, final) => {
      if (failed) return
      if (error) return fail(`Could not be extracted: ${error.message}`)
      fileBytes += chunk.byteLength
      if (declaredSize === null) totalMeshBytes += chunk.byteLength
      if (fileBytes > MAX_MESH_FILE_BYTES || (declaredSize !== null && fileBytes > declaredSize)) {
        return fail(tooLarge())
      }
      if (totalMeshBytes > MAX_TOTAL_MESH_BYTES) return fail(overBudget)
      chunks.push(chunk)
      if (final) {
        if (declaredSize !== null && declaredSize !== fileBytes) {
          return fail('Skipped: the extracted size does not match the ZIP directory')
        }
        entries.push({ name: file.name, category, bytes: concat(chunks, fileBytes), byteSize: fileBytes })
      }
    }

    try {
      file.start()
    } catch (error) {
      fail(`Could not be extracted: ${error instanceof Error ? error.message : 'unsupported compression'}`)
    }
  })
  unzip.register(UnzipPassThrough)
  unzip.register(UnzipInflate)

  const reader = response.body.getReader()
  let loadedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      loadedBytes += value.byteLength
      if (loadedBytes > MAX_ARCHIVE_BYTES) {
        await reader.cancel()
        throw sizeError(MAX_ARCHIVE_BYTES)
      }
      unzip.push(value)
      onProgress?.({ loadedBytes, totalBytes: contentLength })
    }
    unzip.push(new Uint8Array(0), true)
  } finally {
    reader.releaseLock()
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name))
}
