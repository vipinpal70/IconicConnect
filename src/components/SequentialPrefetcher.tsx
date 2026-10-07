"use client"

import { useEffect } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"

export type PrefetchTask = {
  /** Label only (debugging). */
  name: string
  run: (queryClient: QueryClient, signal: AbortSignal) => Promise<unknown>
}

const DONE_FLAG = "iconic_prefetch_done"
export const resetPrefetchFlag = () => {
  try { sessionStorage.removeItem(DONE_FLAG) } catch { /* ignore */ }
}

/**
 * Warms the app one step at a time, in priority order, once per login: the page the user landed on loads
 * normally and untouched; only after it has settled do the remaining tasks run strictly one after another
 * (never in parallel), so background work can't compete with what the user is looking at or burst the DB
 * pool. Skipped on Save-Data connections and when the tab is hidden.
 */
export function SequentialPrefetcher({ tasks }: { tasks: PrefetchTask[] }) {
  const queryClient = useQueryClient()

  useEffect(() => {
    try { if (sessionStorage.getItem(DONE_FLAG)) return } catch { /* ignore */ }
    if ((navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData) return

    const controller = new AbortController()
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

    ;(async () => {
      await sleep(2000) // let the current page finish its own requests first
      if (controller.signal.aborted || document.hidden) return
      try { sessionStorage.setItem(DONE_FLAG, "1") } catch { /* ignore */ }
      for (const task of tasks) {
        if (controller.signal.aborted) return
        try { await task.run(queryClient, controller.signal) } catch { /* best effort */ }
        await sleep(300)
      }
    })()

    return () => controller.abort()
    // tasks are static per layout; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
