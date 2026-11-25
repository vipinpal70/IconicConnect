"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { onLiveEvent, onLiveResync, useLiveStatus } from "@/src/lib/live/client"
import { mergeCaseRows, type CaseRow } from "@/src/lib/live/case-rows"
import { useVisibleInterval } from "@/src/hooks/useVisibleInterval"

/** GET /api/cases answers for at most this many ids (MAX_CASE_IDS in live/publish). */
const MAX_IDS = 50
/** A list asks at most once in this time, however many cases change. */
const MIN_GAP_MS = 10_000
const JITTER_MS = 3_000

interface Options<T extends CaseRow> {
  /** The rows loaded now. */
  rows: T[]
  /** The list's own request URL with its filters; `ids` is added to it. */
  url: () => string
  priorityStatus: string
  filtered: boolean
  hasMore: boolean
  change: (fn: (rows: T[]) => T[]) => void
  /** Loads everything loaded so far again, without a spinner. */
  reload: () => void
  /** The slow refresh: the fallback while the live connection is down, the safety net while it is up. */
  refresh: () => void
  onFresh?: (rows: T[]) => void
}

/**
 * Keeps a cases list up to date: changed rows are fetched on their own, grouped, at most every 10 s. A filtered
 * list isn't reordered: `updatesAvailable` says that a refresh would show more.
 */
export function useLiveCases<T extends CaseRow>(options: Options<T>) {
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  const [updatesAvailable, setUpdatesAvailable] = useState(false)
  const live = useLiveStatus() === "live"

  useEffect(() => {
    const pending = new Set<string>()
    let all = false
    let lastRun = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const visible = () => document.visibilityState === "visible"

    const run = async () => {
      timer = null
      if (stopped || !visible()) return // runs when shown
      const ids = [...pending]
      const everything = all || ids.length > MAX_IDS
      pending.clear()
      all = false
      if (!everything && !ids.length) return
      lastRun = Date.now()
      if (everything) {
        if (latest.current.filtered) setUpdatesAvailable(true)
        else latest.current.reload()
        return
      }
      const url = latest.current.url()
      try {
        const res = await fetch(`${url}&ids=${ids.join(",")}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data?: T[]; matching?: string[] }
        // The filters changed meanwhile: that list was loaded after these changes
        if (stopped || latest.current.url() !== url) return
        const { rows, priorityStatus, filtered, hasMore, change, reload, onFresh } = latest.current
        const merge = (current: T[]) =>
          mergeCaseRows(current, ids, json.data ?? [], json.matching ?? [], { priorityStatus, filtered, hasMore })
        const outcome = merge(rows)
        change((current) => merge(current).rows)
        onFresh?.(json.data ?? [])
        if (outcome.updatesAvailable) setUpdatesAvailable(true)
        if (outcome.reload) reload()
      } catch (err) {
        console.error("Error updating cases:", err)
        ids.forEach((id) => pending.add(id))
        if (!stopped) schedule()
      }
    }

    function schedule() {
      if (timer || !visible()) return
      timer = setTimeout(run, Math.max(Math.random() * JITTER_MS, lastRun + MIN_GAP_MS - Date.now()))
    }

    const onResync = () => {
      all = true
      schedule()
    }
    const offs = [
      onLiveEvent((type, data) => {
        if (type === "case") {
          if (Array.isArray(data.ids)) data.ids.forEach((id) => pending.add(String(id)))
          else all = true
        } else if (type === "chat" && data.kind === "changed" && typeof data.caseId === "string") {
          pending.add(data.caseId) // a deleted message may take the chat badge with it
        } else {
          return
        }
        schedule()
      }),
      onLiveResync("lab", onResync),
      onLiveResync("staff", onResync),
    ]
    const onShown = () => {
      if (!visible() || (!pending.size && !all)) return
      if (timer) clearTimeout(timer)
      void run()
    }
    document.addEventListener("visibilitychange", onShown)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      offs.forEach((off) => off())
      document.removeEventListener("visibilitychange", onShown)
    }
  }, [])

  // While live, a filtered list only changes in place; the notice offers the rest
  useVisibleInterval(options.refresh, live ? 5 * 60_000 : 60_000, !(live && options.filtered))

  /** Call when the list is loaded again. */
  const clearUpdates = useCallback(() => setUpdatesAvailable(false), [])
  return { updatesAvailable, clearUpdates }
}
