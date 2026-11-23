'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { SupportSide } from '@/src/lib/support/constants'

/**
 * One live connection per browser tab (support-system.md §11), shared by the support page and the
 * floating widget. Server events only say *what* changed; this module refreshes the matching cached
 * queries, which refetch through the normal API. While the connection is down, the queries fall back
 * to polling (see `pollInterval`).
 */

export type LiveStatus = 'connecting' | 'live' | 'offline'

interface TypingEntry {
  name: string
  side: SupportSide
  until: number
}

const TYPING_SHOW_MS = 6_000

const state = {
  status: 'connecting' as LiveStatus,
  typing: new Map<string, Map<string, TypingEntry>>(), // ticketId → userId → entry
  version: 0,
}
const listeners = new Set<() => void>()
const emit = () => {
  state.version++
  listeners.forEach((l) => l())
}
const subscribeStore = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

let source: EventSource | null = null
let users = 0
let queryClient: QueryClient | null = null
let typingTimer: ReturnType<typeof setInterval> | null = null

const support = ['support'] as const
const invalidateTicket = (qc: QueryClient, ticketId: string) => {
  void qc.invalidateQueries({ queryKey: ['support', 'ticket', ticketId] })
  void qc.invalidateQueries({ queryKey: ['support', 'messages', ticketId, 'poll'] })
  void qc.invalidateQueries({ queryKey: ['support', 'list'] })
  void qc.invalidateQueries({ queryKey: ['support', 'summary'] })
  void qc.invalidateQueries({ queryKey: ['sidebar-badges'] })
}

function handle(type: string, data: string) {
  const qc = queryClient
  if (!qc) return
  let event: Record<string, unknown> = {}
  try {
    event = JSON.parse(data)
  } catch {
    return
  }
  const ticketId = typeof event.ticketId === 'string' ? event.ticketId : null
  switch (type) {
    case 'resync':
      void qc.invalidateQueries({ queryKey: support })
      break
    case 'message':
      if (!ticketId) return
      state.typing.delete(ticketId) // whoever was typing has just sent
      emit()
      invalidateTicket(qc, ticketId)
      break
    case 'ticket':
      if (ticketId) invalidateTicket(qc, ticketId)
      break
    case 'read':
      if (ticketId) void qc.invalidateQueries({ queryKey: ['support', 'ticket', ticketId] })
      break
    case 'typing': {
      if (!ticketId || typeof event.userId !== 'string') return
      const map = state.typing.get(ticketId) ?? new Map<string, TypingEntry>()
      map.set(event.userId, { name: String(event.name ?? 'Someone'), side: event.side === 'agent' ? 'agent' : 'customer', until: Date.now() + TYPING_SHOW_MS })
      state.typing.set(ticketId, map)
      emit()
      break
    }
  }
}

function connect() {
  if (source || typeof window === 'undefined' || typeof EventSource === 'undefined') return
  state.status = 'connecting'
  emit()
  const es = new EventSource('/api/support/stream')
  source = es
  es.onopen = () => {
    state.status = 'live'
    emit()
  }
  es.onerror = () => {
    // The browser reconnects by itself; CLOSED means it gave up (e.g. 429 or 401): poll instead
    state.status = es.readyState === EventSource.CLOSED ? 'offline' : 'connecting'
    if (es.readyState === EventSource.CLOSED) source = null
    emit()
  }
  for (const type of ['resync', 'message', 'ticket', 'read', 'typing']) {
    es.addEventListener(type, (e) => handle(type, (e as MessageEvent<string>).data))
  }
  es.addEventListener('logout', () => {
    es.close()
    source = null
    state.status = 'offline'
    emit()
  })
  // Expire typing indicators
  typingTimer = setInterval(() => {
    const now = Date.now()
    let changed = false
    for (const [ticketId, map] of state.typing) {
      for (const [userId, entry] of map) {
        if (entry.until <= now) {
          map.delete(userId)
          changed = true
        }
      }
      if (map.size === 0) state.typing.delete(ticketId)
    }
    if (changed) emit()
  }, 1000)
}

function disconnect() {
  source?.close()
  source = null
  if (typingTimer) clearInterval(typingTimer)
  typingTimer = null
  state.status = 'offline'
  state.typing.clear()
}

/** Keeps the tab's live connection open while any component using it is mounted. */
export function useSupportStream() {
  const qc = useQueryClient()
  useEffect(() => {
    queryClient = qc
    users++
    connect()
    return () => {
      users--
      if (users === 0) disconnect()
    }
  }, [qc])
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(subscribeStore, () => state.status, () => 'connecting')
}

/** Polling only matters while the live connection is down. */
export function pollInterval(fallbackMs: number): () => number {
  return () => (state.status === 'live' ? Math.max(fallbackMs, 60_000) : fallbackMs)
}

/** Names of the other people currently typing in a conversation. */
export function useTypingNames(ticketId: string, viewerId: string): string[] {
  const version = useSyncExternalStore(subscribeStore, () => state.version, () => 0)
  void version
  const map = state.typing.get(ticketId)
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
