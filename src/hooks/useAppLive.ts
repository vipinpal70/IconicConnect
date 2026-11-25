"use client"

import { useEffect } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { invalidateLive, onLiveEvent, onLiveResync, useLive } from "@/src/lib/live/client"
import { BADGES_KEY, type SidebarBadges } from "@/src/hooks/useSidebarBadges"

/**
 * The live connection on every page: the bell and the sidebar dots. Most events say what the dot is now, so
 * nothing is requested.
 */

let users = 0
let stop: (() => void) | null = null

function start(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Ask the server, once for a burst of events, and not everyone in the same instant. */
  const recheck = () => {
    timer ??= setTimeout(() => {
      timer = null
      invalidateLive(qc, BADGES_KEY)
    }, 1_000 + Math.random() * 1_500)
  }
  const set = (key: string, on: boolean) => {
    // An answer already on its way was read before this event: ask again after it
    if (qc.isFetching({ queryKey: BADGES_KEY }) > 0) recheck()
    qc.setQueryData<SidebarBadges>(BADGES_KEY, (old) => (old && old[key] !== on ? { ...old, [key]: on } : old))
  }
  const refreshNotifications = () => {
    invalidateLive(qc, ["notifications"])
    invalidateLive(qc, ["notifications-unread-count"])
  }

  const offs = [
    onLiveEvent((type, data) => {
      switch (type) {
        case "notification":
          set("notifications", data.unread === true)
          refreshNotifications()
          break
        case "badge":
          if (typeof data.key === "string" && typeof data.on === "boolean") set(data.key, data.on)
          else recheck()
          break
        // The Support dot counts unread conversations, which only the server can work out
        case "message":
        case "ticket":
        case "read":
          recheck()
          break
      }
    }),
    ...(["user", "lab", "labs", "staff", "support"] as const).map((area) =>
      onLiveResync(area, () => {
        recheck()
        if (area === "user") refreshNotifications()
      }),
    ),
  ]
  return () => {
    offs.forEach((off) => off())
    if (timer) clearTimeout(timer)
  }
}

/** Once per page layout. */
export function useAppLive() {
  const qc = useQueryClient()
  useLive()
  useEffect(() => {
    if (users++ === 0) stop = start(qc)
    return () => {
      if (--users > 0) return
      stop?.()
      stop = null
    }
  }, [qc])
}
