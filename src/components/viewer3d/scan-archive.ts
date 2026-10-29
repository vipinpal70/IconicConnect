import { parse } from '3shape-dcm'
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
const MAX_DCM_FILE_BYTES = 128 * 1024 * 1024
const MAX_TOTAL_DCM_BYTES = 256 * 1024 * 1024
const MAX_DCM_FILES = 24

export type ParsedDcmMesh = ReturnType<typeof parse>

export interface ScanMeshFile {
  name: string
  mesh: ParsedDcmMesh
}

export interface ScanArchiveProgress {
  loadedBytes: number
  totalBytes: number | null
}

function isDcmInFolder(name: string, folders: ReadonlySet<string>): boolean {
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean)
  const baseName = parts[parts.length - 1]?.toLowerCase()
  return !!baseName?.endsWith('.dcm') && parts.slice(0, -1).some((part) => folders.has(part.toLowerCase()))
}

function archiveSizeError(): Error {
  return new Error(`3D archive is larger than the viewer limit of ${Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024)} MB.`)
}

async function readResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`3D file is larger than the viewer limit of ${Math.round(maxBytes / 1024 / 1024)} MB.`)
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw new Error(`3D file is larger than the viewer limit of ${Math.round(maxBytes / 1024 / 1024)} MB.`)
    }
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new Error(`3D file is larger than the viewer limit of ${Math.round(maxBytes / 1024 / 1024)} MB.`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchFileResponse(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Could not load 3D file (HTTP ${response.status}).`)
  }
  return response
}

async function fetchFile(url: string, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
  return readResponse(await fetchFileResponse(url, signal), maxBytes)
}

async function extractDcmFiles(
  response: Response,
  folderNames: string[],
  onProgress?: (progress: ScanArchiveProgress) => void,
): Promise<Array<[string, Uint8Array]>> {
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) throw archiveSizeError()
  if (!response.body) {
    throw new Error('The browser cannot stream this 3D archive.')
  }

  const folders = new Set(folderNames.map((name) => name.toLowerCase()))
  const entries: Array<[string, Uint8Array]> = []
  let totalDcmBytes = 0
  let dcmCount = 0
  let limitError: Error | null = null
  const unzip = new Unzip((file) => {
    if (!isDcmInFolder(file.name, folders) || limitError) return
    const declaredSize = file.originalSize
    if (typeof declaredSize === 'number' && declaredSize > MAX_DCM_FILE_BYTES) {
      limitError = new Error(`A scan mesh exceeds the ${Math.round(MAX_DCM_FILE_BYTES / 1024 / 1024)} MB per-file viewer limit.`)
      return
    }
    if (dcmCount >= MAX_DCM_FILES || (typeof declaredSize === 'number' && totalDcmBytes + declaredSize > MAX_TOTAL_DCM_BYTES)) {
      limitError = new Error('The archive contains more scan data than the viewer can safely load at once.')
      return
    }
    dcmCount += 1

    const chunks: Uint8Array[] = []
    let fileBytes = 0
    file.ondata = (error, chunk, final) => {
      if (limitError) return
      if (error) {
        limitError = new Error(`Could not extract ${file.name} from the 3D archive: ${error.message}`)
        return
      }
      fileBytes += chunk.byteLength
      if (fileBytes > MAX_DCM_FILE_BYTES || totalDcmBytes + chunk.byteLength > MAX_TOTAL_DCM_BYTES) {
        limitError = new Error('The archive contains more scan data than the viewer can safely load at once.')
        return
      }
      totalDcmBytes += chunk.byteLength
      chunks.push(chunk)
      if (final) {
        if (typeof declaredSize === 'number' && declaredSize !== fileBytes) {
          limitError = new Error(`The extracted size of ${file.name} does not match the ZIP directory.`)
          return
        }
        const bytes = new Uint8Array(fileBytes)
        let offset = 0
        for (const part of chunks) {
          bytes.set(part, offset)
          offset += part.byteLength
        }
        entries.push([file.name, bytes])
      }
    }

    try {
      file.start()
    } catch (error) {
      limitError = new Error(`Could not extract ${file.name} from the 3D archive: ${error instanceof Error ? error.message : 'unsupported compression'}`)
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
        throw archiveSizeError()
      }
      unzip.push(value)
      onProgress?.({ loadedBytes, totalBytes: Number.isFinite(contentLength) ? contentLength : null })
      if (limitError) {
        await reader.cancel()
        throw limitError
      }
    }
    unzip.push(new Uint8Array(0), true)
  } finally {
    reader.releaseLock()
  }

  if (limitError) throw limitError
  return entries.sort(([a], [b]) => a.localeCompare(b))
}

function parseMeshes(entries: Array<[string, Uint8Array]>): ScanMeshFile[] {
  const meshes: ScanMeshFile[] = []
  const errors: string[] = []

  for (const [name, bytes] of entries) {
    try {
      meshes.push({ name, mesh: parse(bytes) })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown DCM parsing error')
    }
  }

  if (meshes.length === 0) {
    throw new Error(errors[0] || 'No readable 3Shape DCM scan meshes were found.')
  }
  if (errors.length > 0) {
    throw new Error(`Could not decode ${errors.length} of ${entries.length} 3Shape scan mesh files: ${errors[0]}`)
  }
  return meshes
}

export async function load3ShapeDcmFile(url: string, signal: AbortSignal): Promise<ScanMeshFile[]> {
  const bytes = await fetchFile(url, signal, MAX_DCM_FILE_BYTES)
  return parseMeshes([['scan.dcm', bytes]])
}

export async function load3ShapeScanArchive(
  url: string,
  signal: AbortSignal,
  onProgress?: (progress: ScanArchiveProgress) => void,
): Promise<ScanMeshFile[]> {
  let entries = await extractDcmFiles(await fetchFileResponse(url, signal), ['scans', 'scan'], onProgress)
  if (entries.length === 0) {
    entries = await extractDcmFiles(await fetchFileResponse(url, signal), ['cad'], onProgress)
  }
  if (entries.length === 0) {
    throw new Error('No DCM scan meshes were found in the ZIP archive.')
  }
  return parseMeshes(entries)
}
