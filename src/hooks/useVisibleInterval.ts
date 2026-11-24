"use client"

import { useEffect, useRef } from "react"

/**
 * Runs `callback` every `ms` while the tab is visible. A hidden tab runs nothing; when it is shown again the
 * callback runs at once if it is due. `enabled: false` stops it.
 */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true) {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  })

  useEffect(() => {
    if (!enabled) return
    let last = Date.now()
    let timer: ReturnType<typeof setInterval> | null = null
    const run = () => {
      last = Date.now()
      latest.current()
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const sync = () => {
      stop()
      if (document.visibilityState !== "visible") return
      if (Date.now() - last >= ms) run()
      timer = setInterval(run, ms)
    }
    sync()
    document.addEventListener("visibilitychange", sync)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", sync)
    }
  }, [ms, enabled])
}
