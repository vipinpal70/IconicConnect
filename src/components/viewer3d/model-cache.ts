'use client'

import type { LoadedModel, ModelRequest } from './model-pipeline'
import type { ScanArchiveProgress } from './scan-archive'
import type { WorkerRequest, WorkerResponse } from './model-loader.worker'

/**
 * Session cache for parsed 3D models, shared by every viewer on the page.
 *
 * - Loads run in a Web Worker so download, unzip, parsing and BVH building never block the UI.
 * - Parsed models stay in memory (LRU, byte-budgeted) so reopening the viewer or switching between
 *   the case submission and the design output is instant.
 * - `prefetchModel` lets buttons start the download on hover/focus, before the click.
 *
 * Nothing is written to disk: files are patient data and the proxy serves them `no-store`.
 */

const MAX_CACHE_BYTES = 640 * 1024 * 1024
const MAX_CACHE_ENTRIES = 4

type Listener = (progress: ScanArchiveProgress | null) => void

interface Entry {
  promise: Promise<LoadedModel>
  progress: ScanArchiveProgress | null
  listeners: Set<Listener>
  byteLength: number
  settled: boolean
}

export interface ModelLoad {
  promise: Promise<LoadedModel>
  /** Subscribe to download progress; called immediately with the current value. */
  subscribe: (listener: Listener) => () => void
}

const cache = new Map<string, Entry>()
const keyOf = (r: ModelRequest) => `${r.purpose}|${r.url}`

// ---------------------------------------------------------------------------
// Worker transport (falls back to the main thread if workers are unavailable)
// ---------------------------------------------------------------------------
interface Pending {
  request: ModelRequest
  onProgress: (p: ScanArchiveProgress) => void
  resolve: (model: LoadedModel) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, Pending>()

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
    const job = pending.get(message.id)
    if (!job) return
    if (message.type === 'progress') {
      job.onProgress({ loadedBytes: message.loadedBytes, totalBytes: message.totalBytes })
    } else if (message.type === 'done') {
      pending.delete(message.id)
      job.resolve(message.model)
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
    for (const job of jobs) runOnMainThread(job.request, job.onProgress).then(job.resolve, job.reject)
  }
  return worker
}

async function runOnMainThread(request: ModelRequest, onProgress: (p: ScanArchiveProgress) => void): Promise<LoadedModel> {
  const { loadModelData } = await import('./model-pipeline')
  return loadModelData(request, new AbortController().signal, onProgress)
}

function runLoad(request: ModelRequest, onProgress: (p: ScanArchiveProgress) => void): Promise<LoadedModel> {
  const w = getWorker()
  if (!w) return runOnMainThread(request, onProgress)
  return new Promise<LoadedModel>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { request, onProgress, resolve, reject })
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
  for (const entry of cache.values()) total += entry.byteLength
  for (const [key, entry] of cache) {
    if (total <= MAX_CACHE_BYTES && cache.size <= MAX_CACHE_ENTRIES) break
    if (key === keep || !entry.settled || entry.listeners.size > 0) continue
    cache.delete(key)
    total -= entry.byteLength
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
      promise: Promise.resolve(null as unknown as LoadedModel),
      progress: { loadedBytes: 0, totalBytes: null },
      listeners: new Set(),
      byteLength: 0,
      settled: false,
    }
    created.promise = runLoad(request, (progress) => {
      created.progress = progress
      created.listeners.forEach((l) => l(progress))
    }).then(
      (model) => {
        created.settled = true
        created.progress = null
        created.byteLength = model.byteLength
        created.listeners.forEach((l) => l(null))
        evict(key)
        return model
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
