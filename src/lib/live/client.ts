'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * The browser's side of the live connection: one connection per browser, not per tab.
 *
 * Tabs agree on a leader (Web Locks). The leader holds the EventSource and passes every event on to the other
 * tabs (BroadcastChannel). When it closes, the lock moves to another tab; when it freezes, a visible tab
 * notices the missing heartbeat and takes over. Browsers without these features use a connection per tab.
 */

export type LiveStatus = 'connecting' | 'live' | 'offline'
export type LiveData = Record<string, unknown>
type Handler = (type: string, data: LiveData) => void

type PeerMessage =
  | { k: 'event'; type: string; data: LiveData }
  /** `age`: how long ago the leader last heard from the server. A frozen tab answers, but hears nothing. */
  | { k: 'state'; status: LiveStatus; known: Record<string, number>; age: number }
  | { k: 'beat' }
  | { k: 'who' }

const LOCK = 'iconic-live-leader'
const CHANNEL = 'iconic-live'
/** Events sent by the server under these names are handled here; everything else goes to the handlers. */
const EVENT_TYPES = ['notification', 'badge', 'chat', 'chat-read', 'message', 'ticket', 'read', 'typing'] as const
const SILENT_MS = 60_000
const PRESENCE_MS = 4 * 60_000
/** Kept open briefly with nobody using it: moving between page layouts must not reconnect. */
const LINGER_MS = 5_000

let status: LiveStatus = 'connecting'
let known: Record<string, number> = {}
let source: EventSource | null = null
let peers: BroadcastChannel | null = null
let leading = false
let releaseLead: (() => void) | null = null
let pendingLead: AbortController | null = null
let lastBeat = 0
let lastPresence = 0
let users = 0
let joined = false
let lingerTimer: ReturnType<typeof setTimeout> | null = null
let watchTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let takeoverTimer: ReturnType<typeof setTimeout> | null = null

const statusListeners = new Set<() => void>()
const handlers = new Set<Handler>()
const resyncs = new Map<string, Set<() => void>>()
const resyncTimers = new Map<string, ReturnType<typeof setTimeout>>()

const visible = () => document.visibilityState === 'visible'
const tell = (message: PeerMessage) => peers?.postMessage(message)

function setStatus(next: LiveStatus) {
  if (status === next) return
  status = next
  statusListeners.forEach((l) => l())
  if (leading) tell({ k: 'state', status, known, age: Date.now() - lastBeat })
}

/** An area may have changed while we weren't listening. Spread out, so that everyone doesn't ask at once. */
function scheduleResync(area: string, withinMs: number) {
  if (resyncTimers.has(area)) return
  resyncTimers.set(area, setTimeout(() => {
    resyncTimers.delete(area)
    resyncs.get(area)?.forEach((fn) => fn())
  }, Math.random() * withinMs))
}

/** Every tab runs this for every event, whichever tab received it. */
function receive(type: string, data: LiveData) {
  lastBeat = Date.now()
  if (type === 'logout') {
    leave()
    setStatus('offline')
    if (!location.pathname.startsWith('/auth')) location.assign('/auth/sign-in?reason=session_expired')
    return
  }
  if (type === 'hello') {
    const versions = (data.versions ?? {}) as Record<string, number | null>
    for (const [area, version] of Object.entries(versions)) {
      const before = known[area]
      if (version === null || before !== version) scheduleResync(area, before === undefined ? 1_000 : 5_000)
      if (version !== null) known[area] = version
    }
    setStatus('live')
    return
  }
  if (typeof data.v === 'number' && typeof data.a === 'string') {
    const area = data.a
    // A number was skipped: an event got lost on the way
    if (known[area] !== undefined && data.v > known[area] + 1) scheduleResync(area, 2_000)
    if (known[area] === undefined || data.v > known[area]) known[area] = data.v
  }
  handlers.forEach((handler) => handler(type, data))
}

// ── The connection (leader only) ──────────────────────────────────────────────────────────────────

function connect() {
  if (source || retryTimer) return
  setStatus('connecting')
  lastBeat = Date.now()
  const es = new EventSource('/api/live')
  source = es
  es.onerror = () => {
    if (source !== es) return
    if (es.readyState !== EventSource.CLOSED) return setStatus('connecting') // the browser reconnects by itself
    // It gave up (turned off, too many windows, server error): slow polling meanwhile, and try again later
    source = null
    setStatus('offline')
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (leading || !peers) connect()
    }, 60_000 + Math.random() * 30_000)
  }
  const on = (type: string, fn: (data: LiveData) => void) =>
    es.addEventListener(type, (e) => {
      let data: LiveData = {}
      try {
        data = JSON.parse((e as MessageEvent<string>).data)
      } catch {
        return
      }
      fn(data)
    })
  on('beat', () => {
    lastBeat = Date.now()
    tell({ k: 'beat' })
  })
  on('logout', () => void sessionEnded())
  for (const type of ['hello', ...EVENT_TYPES]) {
    on(type, (data) => {
      tell({ k: 'event', type, data })
      receive(type, data)
    })
  }
}

/** The connection's session ended. Someone may have signed in again in another tab meanwhile: then just reconnect. */
async function sessionEnded() {
  disconnect()
  setStatus('connecting')
  const answer = await fetch('/api/live/presence', { method: 'POST' }).catch(() => null)
  if (!joined) return
  if (answer?.status === 401) {
    tell({ k: 'event', type: 'logout', data: {} })
    receive('logout', {})
  } else if (leading || !peers) {
    connect()
  }
}

function disconnect() {
  source?.close()
  source = null
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
}

// ── Choosing the leader ───────────────────────────────────────────────────────────────────────────

function requestLead(steal: boolean) {
  pendingLead?.abort()
  const controller = new AbortController()
  pendingLead = controller
  const hold = () =>
    new Promise<void>((resolve) => {
      if (controller.signal.aborted || !joined) return resolve()
      leading = true
      releaseLead = resolve
      connect()
    })
  navigator.locks.request(LOCK, steal ? { steal: true } : { signal: controller.signal }, hold).catch(() => {
    // Given up on purpose, or another tab took over because this one looked frozen
    if (!leading || pendingLead !== controller) return
    leading = false
    releaseLead = null
    disconnect()
    if (joined) {
      requestLead(false)
      tell({ k: 'who' })
    }
  })
}

function onPeer(message: PeerMessage) {
  switch (message.k) {
    case 'event':
      receive(message.type, message.data)
      break
    case 'beat':
      lastBeat = Date.now()
      break
    case 'state':
      lastBeat = Date.now() - message.age
      if (message.age < SILENT_MS || message.status !== 'live') {
        if (takeoverTimer) clearTimeout(takeoverTimer)
        takeoverTimer = null
      }
      // Joining tabs learn where things stand; every later event reaches them too
      for (const [area, version] of Object.entries(message.known)) known[area] ??= version
      setStatus(message.status)
      break
    case 'who':
      if (leading) tell({ k: 'state', status, known, age: Date.now() - lastBeat })
      break
  }
}

/** No heartbeat for a minute: the connection is dead (leader) or the leader is frozen (other tabs). */
function watch() {
  if (status === 'offline' || Date.now() - lastBeat < SILENT_MS) return
  if (leading || !peers) {
    disconnect()
    connect()
    return
  }
  if (!visible() || takeoverTimer) return
  tell({ k: 'who' })
  takeoverTimer = setTimeout(() => {
    takeoverTimer = null
    if (joined && !leading) requestLead(true)
  }, 3_000)
}

function join() {
  if (joined) return
  joined = true
  lastBeat = Date.now()
  watchTimer = setInterval(watch, 15_000)
  if (typeof navigator.locks?.request !== 'function' || typeof BroadcastChannel === 'undefined') {
    connect()
    return
  }
  peers = new BroadcastChannel(CHANNEL)
  peers.onmessage = (e) => onPeer(e.data as PeerMessage)
  tell({ k: 'who' })
  requestLead(false)
}

function leave() {
  if (!joined) return
  joined = false
  leading = false
  disconnect()
  pendingLead?.abort()
  pendingLead = null
  releaseLead?.()
  releaseLead = null
  peers?.close()
  peers = null
  if (watchTimer) clearInterval(watchTimer)
  if (takeoverTimer) clearTimeout(takeoverTimer)
  watchTimer = takeoverTimer = null
  resyncTimers.forEach((t) => clearTimeout(t))
  resyncTimers.clear()
  known = {}
  setStatus('connecting')
}

// ── Use from components ───────────────────────────────────────────────────────────────────────────

function reportPresence() {
  if (!visible() || Date.now() - lastPresence < 30_000) return
  lastPresence = Date.now()
  fetch('/api/live/presence', { method: 'POST' }).catch(() => {})
}

/** Keeps this tab on the live connection while mounted. Used once per page layout; using it more often is fine. */
export function useLive() {
  const qc = useQueryClient()
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    users++
    if (lingerTimer) clearTimeout(lingerTimer)
    lingerTimer = null
    join()
    reportPresence()
    const presence = setInterval(reportPresence, PRESENCE_MS)
    const onVisibility = () => {
      if (!visible()) return
      reportPresence()
      // What changed while the tab was hidden
      void qc.refetchQueries({ type: 'active', predicate: (q) => q.state.isInvalidated })
    }
    document.addEventListener('visibilitychange', onVisibility)
    const onHide = () => leave()
    const onShow = (e: PageTransitionEvent) => e.persisted && users > 0 && join()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      users--
      clearInterval(presence)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      if (users === 0) lingerTimer = setTimeout(leave, LINGER_MS)
    }
  }, [qc])
}

/** Called for every event, in every tab. Returns an unsubscribe function. */
export function onLiveEvent(handler: Handler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

/** Called when an area may have changed while this browser wasn't listening. */
export function onLiveResync(area: string, fn: () => void): () => void {
  const set = resyncs.get(area) ?? new Set()
  set.add(fn)
  resyncs.set(area, set)
  return () => set.delete(fn)
}

/** Refetches now if the tab is visible; otherwise only marks the data stale, and it loads when the tab is shown. */
export function invalidateLive(qc: QueryClient, queryKey: QueryKey) {
  void qc.invalidateQueries({ queryKey, refetchType: visible() ? 'active' : 'none' })
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l)
      return () => statusListeners.delete(l)
    },
    () => status,
    () => 'connecting',
  )
}

/** Polling only matters while the live connection is down. */
export function pollInterval(fallbackMs: number, liveMs = 60_000): () => number {
  return () => (status === 'live' ? Math.max(fallbackMs, liveMs) : fallbackMs)
}
