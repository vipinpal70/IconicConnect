import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBVH, type SerializedBVH } from 'three-mesh-bvh'
import { parse as parseDcm } from '3shape-dcm'
import {
  MAX_SINGLE_FILE_BYTES,
  extractMeshEntries,
  fetchFileResponse,
  fileExtension,
  readResponse,
  selectEntries,
  type ArchiveEntry,
  type MeshCategory,
  type ModelPurpose,
  type ScanArchiveProgress,
} from './scan-archive'
import { defaultVisibleFiles } from './scan-visibility'
import { isBinaryStl, weldBinaryStl } from './stl-weld'

/**
 * Model loading pipeline: download → unzip → parse → weld → normals, then (in the background)
 * raycast BVH and a simplified display copy for very dense meshes.
 *
 * Everything here is DOM-free so it runs inside the model worker; the main thread only wraps the
 * returned typed arrays in BufferGeometries.
 *
 * Order of work, chosen for time-to-first-view:
 * 1. Only the files shown by default (see scan-visibility.ts) are decoded before the first view.
 *    Hidden files stay as raw bytes in the session and are decoded when switched on.
 * 2. The BVH (needed only for drawing) is built after the model is on screen.
 * 3. Meshes above LOD_MIN_TRIANGLES get a simplified display index (same vertices, ≤ 0.01 mm
 *    deviation). Drawing still raycasts the full mesh.
 */

export interface ModelRequest {
  url: string
  /** Real file name; the proxy URL does not always end in the extension. */
  fileName: string
  purpose: ModelPurpose
}

export type ModelFileStatus = 'ready' | 'deferred' | 'skipped' | 'error'

/** One file of the model (an archive entry, or the single uploaded file). */
export interface ModelFileInfo {
  name: string
  category: MeshCategory
  byteSize: number
  defaultVisible: boolean
  status: ModelFileStatus
  /** Why a file was skipped or failed. */
  reason?: string
}

export interface LoadedMesh {
  /** Unique mesh name (an OBJ file can hold several meshes). */
  name: string
  /** The file this mesh came from; visibility is per file. */
  file: string
  category: MeshCategory
  positions: Float32Array
  normals: Float32Array
  index: Uint32Array | Uint16Array
  colors: Uint8Array | Float32Array | null
  /** [minX, minY, minZ, maxX, maxY, maxZ] */
  bbox: [number, number, number, number, number, number]
  vertexCount: number
  triangleCount: number
}

export interface LoadedModel {
  files: ModelFileInfo[]
  meshes: LoadedMesh[]
}

/** Results that arrive after the initial model, in the order they finish. */
export type ModelEvent =
  | { type: 'meshes'; file: ModelFileInfo; meshes: LoadedMesh[] }
  | { type: 'file'; file: ModelFileInfo }
  /** `bvh` is null if building it failed; the main thread then builds it itself. */
  | { type: 'bvh'; mesh: string; bvh: SerializedBVH | null }
  | { type: 'lod'; mesh: string; index: Uint32Array; triangleCount: number }

/** Meshes above this many triangles get a simplified display copy. */
export const LOD_MIN_TRIANGLES = 2_000_000
const LOD_TARGET_TRIANGLES = 1_500_000
/** Maximum surface deviation of the display copy, in mm (scans are in mm). */
const LOD_MAX_ERROR_MM = 0.01

const SUPPORTED_EXTENSIONS = new Set(['zip', 'dcm', 'stl', 'ply', 'obj'])

export function modelExtension(request: Pick<ModelRequest, 'url' | 'fileName'>): string {
  const fromName = fileExtension(request.fileName)
  if (SUPPORTED_EXTENSIONS.has(fromName)) return fromName
  const fileNameParam = /[?&]fileName=([^&]+)/i.exec(request.url)?.[1]
  if (fileNameParam) {
    const fromParam = fileExtension(decodeURIComponent(fileNameParam))
    if (SUPPORTED_EXTENSIONS.has(fromParam)) return fromParam
  }
  return fileExtension(request.url.split('?')[0])
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer)
}

/** Decode one file into zero or more raw geometries (OBJ may hold several objects). */
function decodeGeometries(name: string, bytes: Uint8Array): THREE.BufferGeometry[] {
  const ext = fileExtension(name)
  if (ext === 'dcm') {
    const mesh = parseDcm(bytes)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3))
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    if (mesh.colors) geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3, true))
    return [geometry]
  }
  if (ext === 'stl') {
    if (isBinaryStl(bytes)) {
      const { positions, index } = weldBinaryStl(bytes)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setIndex(new THREE.BufferAttribute(index, 1))
      return [geometry]
    }
    return [new STLLoader().parse(toArrayBuffer(bytes))]
  }
  if (ext === 'ply') return [new PLYLoader().parse(toArrayBuffer(bytes))]
  if (ext === 'obj') {
    const group = new OBJLoader().parse(new TextDecoder().decode(bytes))
    const geometries: THREE.BufferGeometry[] = []
    group.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh && mesh.geometry) geometries.push(mesh.geometry)
    })
    return geometries
  }
  throw new Error('This 3D file format is not supported by the viewer.')
}

/** Weld (if needed), compute smooth normals and bounds. */
function finalizeMesh(name: string, file: string, category: MeshCategory, source: THREE.BufferGeometry): LoadedMesh {
  let geometry = source
  if (!geometry.getAttribute('position')) throw new Error(`${name} does not contain any geometry.`)

  // ASCII STL / OBJ / some PLY arrive unshared (faceted, 3× the vertices). Welding gives smooth
  // shading and a third of the memory. Drop per-face normals/uvs first or mergeVertices would keep
  // every corner distinct.
  if (!geometry.index) {
    geometry.deleteAttribute('normal')
    geometry.deleteAttribute('uv')
    geometry = mergeVertices(geometry)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const index = geometry.getIndex()!
  const box = geometry.boundingBox!

  return {
    name,
    file,
    category,
    positions: position.array as Float32Array,
    normals: normal.array as Float32Array,
    index: index.array as Uint32Array | Uint16Array,
    colors: color ? (color.array as Uint8Array | Float32Array) : null,
    bbox: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z],
    vertexCount: position.count,
    triangleCount: index.count / 3,
  }
}

function decodeFile(entry: { name: string; category: MeshCategory; bytes: Uint8Array }): LoadedMesh[] {
  const geometries = decodeGeometries(entry.name, entry.bytes)
  if (geometries.length === 0) throw new Error('No geometry found in this file.')
  return geometries.map((geometry, i) =>
    finalizeMesh(geometries.length > 1 ? `${entry.name} #${i + 1}` : entry.name, entry.name, entry.category, geometry),
  )
}

/** Unique ArrayBuffers behind meshes/events, for zero-copy postMessage transfer. */
export function transferablesOf(value: { meshes?: LoadedMesh[] } | ModelEvent): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (view: ArrayBufferView | null | undefined) => {
    if (view && view.buffer instanceof ArrayBuffer) buffers.add(view.buffer)
  }
  if ('meshes' in value && value.meshes) {
    for (const mesh of value.meshes) {
      add(mesh.positions)
      add(mesh.normals)
      add(mesh.index)
      add(mesh.colors)
    }
  }
  if ('type' in value && value.type === 'bvh' && value.bvh) {
    add(value.bvh.indirectBuffer as ArrayBufferView | null)
    for (const root of value.bvh.roots) if (root instanceof ArrayBuffer) buffers.add(root)
  }
  if ('type' in value && value.type === 'lod') add(value.index)
  return [...buffers]
}

export function meshByteLength(mesh: LoadedMesh): number {
  return mesh.positions.byteLength + mesh.normals.byteLength + mesh.index.byteLength + (mesh.colors?.byteLength ?? 0)
}

/** Copies kept by the session for background work; the originals are transferred away. */
interface WorkCopy {
  name: string
  positions: Float32Array
  index: Uint32Array
  triangleCount: number
}

const EMPTY_INDEX = new Uint32Array(0)

/**
 * One loaded model. Runs in the worker (or on the main thread as a fallback); results that finish
 * after the initial load are delivered through `emit`.
 */
export class ModelSession {
  private readonly deferred = new Map<string, ArchiveEntry & { bytes: Uint8Array }>()
  private readonly files = new Map<string, ModelFileInfo>()
  private readonly urgent: Array<() => Promise<void> | void> = []
  private readonly background: Array<() => Promise<void> | void> = []
  private running = false
  private disposed = false

  constructor(private readonly emit: (event: ModelEvent) => void) {}

  async load(
    request: ModelRequest,
    signal: AbortSignal,
    onProgress?: (progress: ScanArchiveProgress) => void,
  ): Promise<LoadedModel> {
    const ext = modelExtension(request)
    if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error('This 3D file format is not supported by the viewer.')

    const response = await fetchFileResponse(request.url, signal)
    let entries: ArchiveEntry[]
    if (ext === 'zip') {
      entries = selectEntries(await extractMeshEntries(response, onProgress), request.purpose)
      if (entries.length === 0) throw new Error('No 3D meshes (DCM, STL, PLY or OBJ) were found in the ZIP archive.')
    } else {
      const bytes = await readResponse(response, MAX_SINGLE_FILE_BYTES, onProgress)
      const name = request.fileName || `model.${ext}`
      entries = [{ name, category: ext === 'dcm' ? 'scan' : 'mesh', bytes, byteSize: bytes.byteLength }]
    }

    const readable = entries.filter((e): e is ArchiveEntry & { bytes: Uint8Array } => e.bytes !== null)
    if (readable.length === 0) throw new Error(entries[0]?.skipReason ?? 'No readable 3D meshes were found.')

    let visible = defaultVisibleFiles(entries, request.purpose)
    // If every default file was skipped (e.g. too large), show whatever can be read
    if (!readable.some((e) => visible.has(e.name))) visible = new Set(readable.map((e) => e.name))

    const meshes: LoadedMesh[] = []
    const errors: string[] = []
    for (const entry of entries) {
      const info: ModelFileInfo = {
        name: entry.name,
        category: entry.category,
        byteSize: entry.byteSize,
        defaultVisible: visible.has(entry.name),
        status: entry.bytes ? 'deferred' : 'skipped',
        reason: entry.skipReason,
      }
      this.files.set(entry.name, info)
      if (!entry.bytes) continue
      if (!info.defaultVisible) {
        this.deferred.set(entry.name, entry as ArchiveEntry & { bytes: Uint8Array })
        continue
      }
      try {
        const decoded = decodeFile(entry as ArchiveEntry & { bytes: Uint8Array })
        meshes.push(...decoded)
        info.status = 'ready'
        this.scheduleFollowUps(decoded, false)
      } catch (error) {
        info.status = 'error'
        info.reason = error instanceof Error ? error.message : 'Could not be read'
        errors.push(`${entry.name}: ${info.reason}`)
      }
    }

    if (meshes.length === 0) throw new Error(errors[0] || 'No readable 3D meshes were found.')
    // A partially readable archive is still useful; the Layers panel shows which files failed.
    if (errors.length > 0) console.warn(`Skipped ${errors.length} unreadable 3D file(s):`, errors)

    return { files: [...this.files.values()].map((f) => ({ ...f })), meshes }
  }

  /** Decode a file that was hidden at load time (the user switched it on). */
  decode(fileName: string): void {
    const entry = this.deferred.get(fileName)
    if (!entry) return
    this.deferred.delete(fileName)
    this.urgent.unshift(() => {
      const info = this.files.get(fileName)!
      try {
        const meshes = decodeFile(entry)
        info.status = 'ready'
        // Queue follow-ups before emitting: emitting transfers (detaches) the mesh arrays
        this.scheduleFollowUps(meshes, true)
        this.emit({ type: 'meshes', file: { ...info }, meshes })
      } catch (error) {
        info.status = 'error'
        info.reason = error instanceof Error ? error.message : 'Could not be read'
        this.emit({ type: 'file', file: { ...info } })
      }
    })
    this.run()
  }

  dispose(): void {
    this.disposed = true
    this.deferred.clear()
    this.urgent.length = 0
    this.background.length = 0
  }

  private scheduleFollowUps(meshes: LoadedMesh[], urgent: boolean): void {
    for (const mesh of meshes) {
      const copy: WorkCopy = {
        name: mesh.name,
        positions: mesh.positions.slice(),
        index: mesh.index instanceof Uint32Array ? mesh.index.slice() : Uint32Array.from(mesh.index),
        triangleCount: mesh.triangleCount,
      }
      const bvhJob = () => this.emit({ type: 'bvh', mesh: copy.name, bvh: buildBvh(copy) })
      ;(urgent ? this.urgent : this.background).push(bvhJob)
      if (copy.triangleCount > LOD_MIN_TRIANGLES) {
        // Display simplification is the least urgent work: it only makes rotation lighter
        this.background.push(async () => {
          const lod = await simplifyForDisplay(copy)
          if (lod && !this.disposed) this.emit({ type: 'lod', mesh: copy.name, ...lod })
        })
      }
    }
    this.run()
  }

  private run(): void {
    if (this.running) return
    this.running = true
    // Yield between jobs so new requests (decode on toggle) can jump the queue
    const next = async () => {
      if (this.disposed) {
        this.running = false
        return
      }
      const job = this.urgent.shift() ?? this.background.shift()
      if (!job) {
        this.running = false
        return
      }
      try {
        await job()
      } catch (error) {
        console.warn('3D background task failed:', error)
      }
      setTimeout(next, 0)
    }
    setTimeout(next, 0)
  }
}

function buildBvh(copy: WorkCopy): SerializedBVH | null {
  try {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(copy.positions, 3))
    geometry.setIndex(new THREE.BufferAttribute(copy.index, 1))
    // Indirect: the BVH keeps its own triangle order instead of reordering the index buffer, so the
    // mesh already on screen does not have to change.
    const bvh = new MeshBVH(geometry, { indirect: true })
    const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false })
    // The main thread keeps its own index; don't send this copy back
    return { ...serialized, index: EMPTY_INDEX }
  } catch (error) {
    console.warn(`Could not build the drawing surface for ${copy.name}:`, error)
    return null
  }
}

async function simplifyForDisplay(copy: WorkCopy): Promise<{ index: Uint32Array; triangleCount: number } | null> {
  try {
    const { MeshoptSimplifier } = await import('meshoptimizer')
    await MeshoptSimplifier.ready
    const [index] = MeshoptSimplifier.simplify(
      copy.index,
      copy.positions,
      3,
      LOD_TARGET_TRIANGLES * 3,
      LOD_MAX_ERROR_MM,
      ['ErrorAbsolute'],
    )
    // Not worth swapping if the error bound stopped it early
    if (index.length > copy.index.length * 0.85) return null
    return { index, triangleCount: index.length / 3 }
  } catch (error) {
    console.warn(`Could not simplify ${copy.name} for display:`, error)
    return null
  }
}
