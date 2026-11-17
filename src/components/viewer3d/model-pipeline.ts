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
  type MeshCategory,
  type ModelPurpose,
  type ScanArchiveProgress,
} from './scan-archive'

/**
 * Model loading pipeline: download → unzip → parse → weld → normals → BVH.
 * Everything here is DOM-free so it runs inside the model worker; the main thread only wraps
 * the returned typed arrays in BufferGeometries (no parsing, no BVH build, no normal pass).
 */

export interface ModelRequest {
  url: string
  /** Real file name; the proxy URL does not always end in the extension. */
  fileName: string
  purpose: ModelPurpose
}

export interface LoadedMesh {
  name: string
  category: MeshCategory
  positions: Float32Array
  normals: Float32Array
  index: Uint32Array | Uint16Array | null
  colors: Uint8Array | Float32Array | null
  bvh: SerializedBVH | null
  /** [minX, minY, minZ, maxX, maxY, maxZ] */
  bbox: [number, number, number, number, number, number]
  vertexCount: number
  triangleCount: number
}

export interface LoadedModel {
  meshes: LoadedMesh[]
  /** Approximate memory held by the typed arrays, used for cache budgeting. */
  byteLength: number
}

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
  if (ext === 'stl') return [new STLLoader().parse(toArrayBuffer(bytes))]
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

/** Weld, compute smooth normals, bounds and the raycast BVH — all off the main thread. */
function finalizeMesh(name: string, category: MeshCategory, source: THREE.BufferGeometry): LoadedMesh {
  let geometry = source
  if (!geometry.getAttribute('position')) throw new Error(`${name} does not contain any geometry.`)

  // STL/OBJ triangles arrive unshared (faceted, 3× the vertices). Welding gives smooth,
  // professional shading and roughly a third of the memory. Drop per-face normals/uvs first
  // or mergeVertices would keep every corner distinct.
  if (!geometry.index) {
    geometry.deleteAttribute('normal')
    geometry.deleteAttribute('uv')
    geometry = mergeVertices(geometry)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()

  const bvh = new MeshBVH(geometry)
  const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false })

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const index = geometry.getIndex()
  const box = geometry.boundingBox!

  return {
    name,
    category,
    positions: position.array as Float32Array,
    normals: normal.array as Float32Array,
    index: (index?.array as Uint32Array | Uint16Array | undefined) ?? null,
    colors: color ? (color.array as Uint8Array | Float32Array) : null,
    bvh: serialized,
    bbox: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z],
    vertexCount: position.count,
    triangleCount: index ? index.count / 3 : position.count / 3,
  }
}

function decodeAll(files: Array<{ name: string; category: MeshCategory; bytes: Uint8Array }>): LoadedMesh[] {
  const meshes: LoadedMesh[] = []
  const errors: string[] = []
  for (const file of files) {
    try {
      const geometries = decodeGeometries(file.name, file.bytes)
      geometries.forEach((geometry, i) => {
        meshes.push(finalizeMesh(geometries.length > 1 ? `${file.name} #${i + 1}` : file.name, file.category, geometry))
      })
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  if (meshes.length === 0) throw new Error(errors[0] || 'No readable 3D meshes were found.')
  // A partially readable archive is still useful; surface the problem in the console only.
  if (errors.length > 0) console.warn(`Skipped ${errors.length} unreadable 3D file(s):`, errors)
  return meshes
}

export async function loadModelData(
  request: ModelRequest,
  signal: AbortSignal,
  onProgress?: (progress: ScanArchiveProgress) => void,
): Promise<LoadedModel> {
  const ext = modelExtension(request)
  if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error('This 3D file format is not supported by the viewer.')

  const response = await fetchFileResponse(request.url, signal)
  let meshes: LoadedMesh[]
  if (ext === 'zip') {
    const entries = selectEntries(await extractMeshEntries(response, onProgress), request.purpose)
    if (entries.length === 0) throw new Error('No 3D meshes (DCM, STL, PLY or OBJ) were found in the ZIP archive.')
    meshes = decodeAll(entries)
  } else {
    const bytes = await readResponse(response, MAX_SINGLE_FILE_BYTES, onProgress)
    const name = request.fileName || `model.${ext}`
    meshes = decodeAll([{ name, category: ext === 'dcm' ? 'scan' : 'mesh', bytes }])
  }

  let byteLength = 0
  for (const buffer of transferablesOf({ meshes, byteLength: 0 })) byteLength += buffer.byteLength
  return { meshes, byteLength }
}

/** Unique ArrayBuffers backing a model, for zero-copy postMessage transfer. */
export function transferablesOf(model: LoadedModel): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (view: ArrayBufferView | null | undefined) => {
    if (view && view.buffer instanceof ArrayBuffer) buffers.add(view.buffer)
  }
  for (const mesh of model.meshes) {
    add(mesh.positions)
    add(mesh.normals)
    add(mesh.index)
    add(mesh.colors)
    if (mesh.bvh) {
      add(mesh.bvh.index as ArrayBufferView | null)
      add(mesh.bvh.indirectBuffer as ArrayBufferView | null)
      for (const root of mesh.bvh.roots) if (root instanceof ArrayBuffer) buffers.add(root)
    }
  }
  return [...buffers]
}
