'use client'

import type { SerializedBVH } from 'three-mesh-bvh'
import {
  meshByteLength,
  type LoadedMesh,
  type LoadedModel,
  type ModelEvent,
  type ModelFileInfo,
  type ModelFileStatus,
  type ModelRequest,
} from './model-pipeline'
import type { ScanArchiveProgress } from './scan-archive'
import type { WorkerRequest, WorkerResponse } from './model-loader.worker'

/**
 * Session cache for parsed 3D models, shared by every viewer on the page.
 *
 * - Loads run in a Web Worker so download, unzip, parsing and BVH building never block the UI.
 * - A loaded model is a live handle: files hidden at load time are decoded on demand, and the
 *   drawing BVH / simplified display copies arrive after the first view.
 * - Parsed models stay in memory (LRU, byte-budgeted) so reopening the viewer or switching between
 *   the case submission and the design output is instant.
 * - `prefetchModel` lets buttons start the download on hover/focus, before the click.
 *
 * Nothing is written to disk: files are patient data and the proxy serves them `no-store`.
 */

const MAX_CACHE_BYTES = 640 * 1024 * 1024
const MAX_CACHE_ENTRIES = 4

export type ViewerFileStatus = ModelFileStatus | 'loading'
export interface ViewerFileInfo extends Omit<ModelFileInfo, 'status'> {
  status: ViewerFileStatus
}

export interface ModelState {
  files: ViewerFileInfo[]
  meshes: LoadedMesh[]
  /** Drawing BVH per mesh name; null = the worker could not build it (build locally). */
  bvh: ReadonlyMap<string, SerializedBVH | null>
  /** Simplified display index per mesh name (very dense meshes only). */
  lod: ReadonlyMap<string, { index: Uint32Array; triangleCount: number }>
  /** The worker died after loading; follow-up work must happen on the main thread. */
  transportLost: boolean
}

export interface ModelHandle {
  getState(): ModelState
  /** Called after every state change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Decode a file that was hidden at load time. */
  decode(file: string): void
}

type ProgressListener = (progress: ScanArchiveProgress | null) => void

interface Transport {
  decode(file: string): void
  release(): void
}

interface LoadCallbacks {
  onProgress: (progress: ScanArchiveProgress) => void
  onEvent: (event: ModelEvent) => void
  onTransportLost: () => void
}

interface Entry {
  promise: Promise<ModelHandle>
  progress: ScanArchiveProgress | null
  listeners: Set<ProgressListener>
  handle: ModelHandleImpl | null
  settled: boolean
}

export interface ModelLoad {
  promise: Promise<ModelHandle>
  /** Subscribe to download progress; called immediately with the current value. */
  subscribe: (listener: ProgressListener) => () => void
}

const cache = new Map<string, Entry>()
const keyOf = (r: ModelRequest) => `${r.purpose}|${r.url}`

// ---------------------------------------------------------------------------
// Live model handle
// ---------------------------------------------------------------------------
class ModelHandleImpl implements ModelHandle {
  private state: ModelState
  private readonly listeners = new Set<() => void>()
  transport: Transport | null = null
  /** Session cache entries whose viewer is open; they are never evicted. */
  activeViewers = 0

  constructor(model: LoadedModel) {
    this.state = { files: model.files, meshes: model.meshes, bvh: new Map(), lod: new Map(), transportLost: false }
  }

  getState = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    this.activeViewers += 1
    return () => {
      this.listeners.delete(listener)
      this.activeViewers -= 1
    }
  }

  decode = (file: string) => {
    const info = this.state.files.find((f) => f.name === file)
    if (!info || info.status !== 'deferred' || !this.transport) return
    if (this.state.transportLost) {
      this.setFile({ ...info, status: 'error', reason: 'Close and reopen the viewer to load this file.' })
      return
    }
    this.setFile({ ...info, status: 'loading' })
    this.transport.decode(file)
  }

  byteLength(): number {
    let total = 0
    for (const mesh of this.state.meshes) total += meshByteLength(mesh)
    for (const lod of this.state.lod.values()) total += lod.index.byteLength
    return total
  }

  apply(event: ModelEvent) {
    switch (event.type) {
      case 'meshes':
        this.update({
          files: this.replaceFile(event.file),
          meshes: [...this.state.meshes, ...event.meshes],
        })
        break
      case 'file':
        this.setFile(event.file)
        break
      case 'bvh':
        this.update({ bvh: new Map(this.state.bvh).set(event.mesh, event.bvh) })
        break
      case 'lod':
        this.update({ lod: new Map(this.state.lod).set(event.mesh, { index: event.index, triangleCount: event.triangleCount }) })
        break
    }
  }

  markTransportLost() {
    this.update({
      transportLost: true,
      files: this.state.files.map((f) =>
        f.status === 'loading' ? { ...f, status: 'error' as const, reason: 'Close and reopen the viewer to load this file.' } : f,
      ),
    })
  }

  private replaceFile(file: ViewerFileInfo) {
    return this.state.files.map((f) => (f.name === file.name ? file : f))
  }

  private setFile(file: ViewerFileInfo) {
    this.update({ files: this.replaceFile(file) })
  }

  private update(patch: Partial<ModelState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }
}

// ---------------------------------------------------------------------------
// Worker transport (falls back to the main thread if workers are unavailable)
// ---------------------------------------------------------------------------
interface Pending extends LoadCallbacks {
  request: ModelRequest
  resolve: (result: { model: LoadedModel; transport: Transport }) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, Pending>()
/** Loaded models whose session lives in the worker, for follow-up events. */
const live = new Map<number, LoadCallbacks>()

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./model-loader.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    if (message.type === 'event') {
      live.get(message.id)?.onEvent(message.event)
      return
    }
    const job = pending.get(message.id)
    if (!job) return
    if (message.type === 'progress') {
      job.onProgress({ loadedBytes: message.loadedBytes, totalBytes: message.totalBytes })
    } else if (message.type === 'done') {
      pending.delete(message.id)
      live.set(message.id, job)
      const id = message.id
      job.resolve({
        model: message.model,
        transport: {
          decode: (file) => worker?.postMessage({ type: 'decode', id, file } satisfies WorkerRequest),
          release: () => {
            live.delete(id)
            worker?.postMessage({ type: 'release', id } satisfies WorkerRequest)
          },
        },
      })
    } else {
      pending.delete(message.id)
      job.reject(new Error(message.message))
    }
  }
  // The worker script itself failed (e.g. blocked or failed to compile): finish in-flight jobs on the main thread
  worker.onerror = (event) => {
    event.preventDefault()
    workerBroken = true
    worker?.terminate()
    worker = null
    const jobs = [...pending.values()]
    pending.clear()
    for (const job of jobs) runOnMainThread(job.request, job).then(job.resolve, job.reject)
    const sessions = [...live.values()]
    live.clear()
    for (const session of sessions) session.onTransportLost()
  }
  return worker
}

async function runOnMainThread(
  request: ModelRequest,
  callbacks: LoadCallbacks,
): Promise<{ model: LoadedModel; transport: Transport }> {
  const { ModelSession } = await import('./model-pipeline')
  const session = new ModelSession(callbacks.onEvent)
  const model = await session.load(request, new AbortController().signal, callbacks.onProgress)
  return { model, transport: { decode: (file) => session.decode(file), release: () => session.dispose() } }
}

function runLoad(request: ModelRequest, callbacks: LoadCallbacks): Promise<{ model: LoadedModel; transport: Transport }> {
  const w = getWorker()
  if (!w) return runOnMainThread(request, callbacks)
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { request, ...callbacks, resolve, reject })
    // Worker fetches resolve relative URLs against the worker script, so send an absolute one
    const absolute = { ...request, url: new URL(request.url, window.location.href).href }
    w.postMessage({ type: 'load', id, request: absolute } satisfies WorkerRequest)
  })
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
function evict(keep: string) {
  let total = 0
  for (const entry of cache.values()) total += entry.handle?.byteLength() ?? 0
  for (const [key, entry] of cache) {
    if (total <= MAX_CACHE_BYTES && cache.size <= MAX_CACHE_ENTRIES) break
    if (key === keep || !entry.settled || entry.listeners.size > 0 || (entry.handle?.activeViewers ?? 0) > 0) continue
    cache.delete(key)
    total -= entry.handle?.byteLength() ?? 0
    entry.handle?.transport?.release()
  }
}

export function loadModel(request: ModelRequest): ModelLoad {
  const key = keyOf(request)
  let entry = cache.get(key)
  if (entry) {
    // Refresh LRU position
    cache.delete(key)
    cache.set(key, entry)
  } else {
    const created: Entry = {
      promise: Promise.resolve(null as unknown as ModelHandle),
      progress: { loadedBytes: 0, totalBytes: null },
      listeners: new Set(),
      handle: null,
      settled: false,
    }
    // Events can only arrive after the load resolves, but buffer defensively
    let handle: ModelHandleImpl | null = null
    const early: ModelEvent[] = []
    created.promise = runLoad(request, {
      onProgress: (progress) => {
        created.progress = progress
        created.listeners.forEach((l) => l(progress))
      },
      onEvent: (event) => {
        if (handle) handle.apply(event)
        else early.push(event)
      },
      onTransportLost: () => handle?.markTransportLost(),
    }).then(
      ({ model, transport }) => {
        handle = new ModelHandleImpl(model)
        handle.transport = transport
        for (const event of early.splice(0)) handle.apply(event)
        created.handle = handle
        created.settled = true
        created.progress = null
        created.listeners.forEach((l) => l(null))
        evict(key)
        return handle
      },
      (error: unknown) => {
        // Failed loads are not cached, so the next open retries
        cache.delete(key)
        created.progress = null
        created.listeners.forEach((l) => l(null))
        throw error
      },
    )
    cache.set(key, created)
    entry = created
  }

  const current = entry
  return {
    promise: current.promise,
    subscribe(listener) {
      current.listeners.add(listener)
      listener(current.progress)
      return () => current.listeners.delete(listener)
    },
  }
}

/** Start loading in the background (e.g. on button hover). Errors surface when the viewer opens. */
export function prefetchModel(request: ModelRequest): void {
  loadModel(request).promise.catch(() => {})
}

export function isModelCached(request: ModelRequest): boolean {
  return cache.get(keyOf(request))?.settled ?? false
}
