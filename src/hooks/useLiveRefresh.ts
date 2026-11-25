"use client"

import { useEffect, useRef } from "react"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"
import { invalidateLive, onLiveEvent, onLiveResync, pollInterval } from "@/src/lib/live/client"

const MIN_GAP_MS = 30_000
const JITTER_MS = 3_000

/** Every minute while the live connection is down; every 5 minutes, as a safety net, while it is up. */
export const dashboardPoll = pollInterval(60_000, 5 * 60_000)

/** Refreshes a dashboard's queries when cases (or what `also` accepts) change, at most every 30 s. */
export function useLiveRefresh(keys: QueryKey[], also?: (type: string, data: Record<string, unknown>) => boolean) {
  const qc = useQueryClient()
  const latest = useRef({ keys, also })
  useEffect(() => {
    latest.current = { keys, also }
  })
  useEffect(() => {
    let lastRun = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) return
      timer = setTimeout(
        () => {
          timer = null
          lastRun = Date.now()
          for (const key of latest.current.keys) invalidateLive(qc, key)
        },
        Math.max(Math.random() * JITTER_MS, lastRun + MIN_GAP_MS - Date.now()),
      )
    }
    const offs = [
      onLiveEvent((type, data) => {
        if (type === "case" || latest.current.also?.(type, data)) schedule()
      }),
      onLiveResync("lab", schedule),
      onLiveResync("staff", schedule),
    ]
    return () => {
      if (timer) clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }, [qc])
}
