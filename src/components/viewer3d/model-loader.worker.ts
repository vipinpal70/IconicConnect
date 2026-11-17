/// <reference lib="webworker" />
import { ModelSession, transferablesOf, type LoadedModel, type ModelEvent, type ModelRequest } from './model-pipeline'

export type WorkerRequest =
  | { type: 'load'; id: number; request: ModelRequest }
  | { type: 'abort'; id: number }
  /** Decode a file that was hidden at load time. */
  | { type: 'decode'; id: number; file: string }
  /** The main thread dropped this model from its cache; free the session. */
  | { type: 'release'; id: number }

export type WorkerResponse =
  | { type: 'progress'; id: number; loadedBytes: number; totalBytes: number | null }
  | { type: 'done'; id: number; model: LoadedModel }
  | { type: 'error'; id: number; message: string }
  | { type: 'event'; id: number; event: ModelEvent }

const scope = self as unknown as DedicatedWorkerGlobalScope
const controllers = new Map<number, AbortController>()
const sessions = new Map<number, ModelSession>()
const PROGRESS_INTERVAL_MS = 80

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'abort') {
    controllers.get(message.id)?.abort()
    return
  }
  if (message.type === 'decode') {
    sessions.get(message.id)?.decode(message.file)
    return
  }
  if (message.type === 'release') {
    controllers.get(message.id)?.abort()
    sessions.get(message.id)?.dispose()
    sessions.delete(message.id)
    return
  }

  const { id, request } = message
  const controller = new AbortController()
  controllers.set(id, controller)
  const session = new ModelSession((modelEvent) => {
    scope.postMessage({ type: 'event', id, event: modelEvent } satisfies WorkerResponse, transferablesOf(modelEvent))
  })
  sessions.set(id, session)
  let lastProgressAt = 0
  try {
    const model = await session.load(request, controller.signal, ({ loadedBytes, totalBytes }) => {
      // Throttle: posting every network chunk would flood the main thread with messages
      const now = performance.now()
      if (now - lastProgressAt < PROGRESS_INTERVAL_MS && loadedBytes !== totalBytes) return
      lastProgressAt = now
      scope.postMessage({ type: 'progress', id, loadedBytes, totalBytes } satisfies WorkerResponse)
    })
    scope.postMessage({ type: 'done', id, model } satisfies WorkerResponse, transferablesOf(model))
  } catch (error) {
    session.dispose()
    sessions.delete(id)
    scope.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : 'Failed to load the 3D model.',
    } satisfies WorkerResponse)
  } finally {
    controllers.delete(id)
  }
}
