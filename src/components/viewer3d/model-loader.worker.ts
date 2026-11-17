/// <reference lib="webworker" />
import { loadModelData, transferablesOf, type ModelRequest } from './model-pipeline'

export type WorkerRequest =
  | { type: 'load'; id: number; request: ModelRequest }
  | { type: 'abort'; id: number }

export type WorkerResponse =
  | { type: 'progress'; id: number; loadedBytes: number; totalBytes: number | null }
  | { type: 'done'; id: number; model: Awaited<ReturnType<typeof loadModelData>> }
  | { type: 'error'; id: number; message: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
const controllers = new Map<number, AbortController>()
const PROGRESS_INTERVAL_MS = 80

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'abort') {
    controllers.get(message.id)?.abort()
    return
  }

  const { id, request } = message
  const controller = new AbortController()
  controllers.set(id, controller)
  let lastProgressAt = 0
  try {
    const model = await loadModelData(request, controller.signal, ({ loadedBytes, totalBytes }) => {
      // Throttle: posting every network chunk would flood the main thread with messages
      const now = performance.now()
      if (now - lastProgressAt < PROGRESS_INTERVAL_MS && loadedBytes !== totalBytes) return
      lastProgressAt = now
      scope.postMessage({ type: 'progress', id, loadedBytes, totalBytes } satisfies WorkerResponse)
    })
    scope.postMessage({ type: 'done', id, model } satisfies WorkerResponse, transferablesOf(model))
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : 'Failed to load the 3D model.',
    } satisfies WorkerResponse)
  } finally {
    controllers.delete(id)
  }
}
