"use client"

import { useEffect, useRef } from "react"
import { onLiveEvent } from "@/src/lib/live/client"

export interface CaseChatBadge {
  id: string
  hasUnreadChat?: boolean
  todayMessagesCount?: number
}

/**
 * Keeps the chat badges of a cases list right without reloading it. `update` applies a change to the row with
 * this case id, if the list has it.
 */
export function useCaseChatBadges(update: (caseId: string, change: <T extends CaseChatBadge>(row: T) => T) => void) {
  const latest = useRef(update)
  useEffect(() => {
    latest.current = update
  })
  useEffect(
    () =>
      onLiveEvent((type, data) => {
        if (typeof data.caseId !== "string") return
        if (type === "chat" && data.kind === "new") {
          latest.current(data.caseId, (row) => ({ ...row, hasUnreadChat: true, todayMessagesCount: (row.todayMessagesCount ?? 0) + 1 }))
        } else if (type === "chat-read") {
          latest.current(data.caseId, (row) => (row.hasUnreadChat ? { ...row, hasUnreadChat: false } : row))
        }
      }),
    [],
  )
}
