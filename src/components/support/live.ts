'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { invalidateLive, onLiveEvent, onLiveResync, useLive, type LiveData } from '@/src/lib/live/client'
import type { SupportSide } from '@/src/lib/support/constants'

/**
 * Support on the app's live connection (support-system.md §11), shared by the support page and the floating
 * widget. Events only say *what* changed; this module refreshes the matching cached queries, which refetch
 * through the normal API.
 */

export { usePollInterval, useLiveStatus, type LiveStatus } from '@/src/lib/live/client'

interface TypingEntry {
  name: string
  side: SupportSide
  until: number
}

const TYPING_SHOW_MS = 6_000

const typing = new Map<string, Map<string, TypingEntry>>() // ticketId → userId → entry
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  listeners.forEach((l) => l())
}
const subscribeStore = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

let users = 0
let stop: (() => void) | null = null

const support = ['support'] as const
const invalidateTicket = (qc: QueryClient, ticketId: string) => {
  invalidateLive(qc, ['support', 'ticket', ticketId])
  invalidateLive(qc, ['support', 'messages', ticketId, 'poll'])
  invalidateLive(qc, ['support', 'list'])
  invalidateLive(qc, ['support', 'summary'])
  // The sidebar dot: useAppLive, on every page
}

function handle(qc: QueryClient, type: string, event: LiveData) {
  const ticketId = typeof event.ticketId === 'string' ? event.ticketId : null
  if (!ticketId) return
  switch (type) {
    case 'message':
      typing.delete(ticketId) // whoever was typing has just sent
      emit()
      invalidateTicket(qc, ticketId)
      break
    case 'ticket':
      invalidateTicket(qc, ticketId)
      break
    case 'read':
      invalidateLive(qc, ['support', 'ticket', ticketId])
      break
    case 'typing': {
      if (typeof event.userId !== 'string') return
      const map = typing.get(ticketId) ?? new Map<string, TypingEntry>()
      map.set(event.userId, { name: String(event.name ?? 'Someone'), side: event.side === 'agent' ? 'agent' : 'customer', until: Date.now() + TYPING_SHOW_MS })
      typing.set(ticketId, map)
      emit()
      break
    }
  }
}

function start(qc: QueryClient) {
  const offEvent = onLiveEvent((type, data) => handle(qc, type, data))
  const offResync = onLiveResync('support', () => invalidateLive(qc, support))
  // Expire typing indicators
  const timer = setInterval(() => {
    if (typing.size === 0) return
    const now = Date.now()
    let changed = false
    for (const [ticketId, map] of typing) {
      for (const [userId, entry] of map) {
        if (entry.until <= now) {
          map.delete(userId)
          changed = true
        }
      }
      if (map.size === 0) typing.delete(ticketId)
    }
    if (changed) emit()
  }, 1000)
  return () => {
    offEvent()
    offResync()
    clearInterval(timer)
    typing.clear()
  }
}

/** Keeps support's data live while any component using it is mounted. */
export function useSupportStream() {
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

/** Names of the other people currently typing in a conversation. */
export function useTypingNames(ticketId: string, viewerId: string): string[] {
  const current = useSyncExternalStore(subscribeStore, () => version, () => 0)
  void current
  const map = typing.get(ticketId)
  if (!map) return []
  return [...map.entries()].filter(([userId]) => userId !== viewerId).map(([, entry]) => entry.name)
}

/** Tells the other side "I'm typing", at most every 3 s while typing continues. */
export function useTypingSender(ticketId: string) {
  const lastSent = useRef(0)
  return useCallback(
    (visibility: 'public' | 'note') => {
      const now = Date.now()
      if (now - lastSent.current < 3000) return
      lastSent.current = now
      void fetch(`/api/support/tickets/${ticketId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
      }).catch(() => {})
    },
    [ticketId],
  )
}
