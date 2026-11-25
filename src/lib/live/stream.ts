import { NextResponse } from 'next/server'
import { aliveSessions, type SessionData } from '@/src/lib/auth/session'
import { redis } from '@/src/lib/redis'
import { isAgentRole } from '@/src/lib/support/constants'
import { listen, onBusReconnect, type LiveEvent } from './bus'
import { closeStream, heartbeatStreams, openStream } from './presence'
import { channelsFor } from './channels'
import { versionKey } from './names'

/**
 * Server-sent events: one stream per browser (§7.1). Events are signals, never content.
 *
 *   hello  {versions}  on connecting, and after Redis was away: the browser refetches only areas that moved
 *   beat               every 25 s: keeps proxies from closing the connection and lets tabs notice a dead one
 *   logout             the session ended
 *   …                  everything published on the person's channels, with its version
 */

const HEARTBEAT_MS = 25_000
/** Backstop: sessions are normally re-checked the moment they change (the `session` event). */
const SESSION_CHECK_EVERY = 12 // beats = 5 minutes
/** A browser this many events behind isn't reading; it will reconnect and catch up. */
const MAX_QUEUED = 200

interface Stream {
  userId: string
  connectionId: string
  isAgent: boolean
  sid: string
  send: (chunk: string) => void
  close: () => void
  hello: () => Promise<void>
}

interface Registry {
  streams: Set<Stream>
  timer: ReturnType<typeof setInterval> | null
  beats: number
  shutdownHooked: boolean
  offReconnect: (() => void) | null
}
const g = globalThis as unknown as { __liveStreams?: Registry }
const registry = (g.__liveStreams ??= { streams: new Set(), timer: null, beats: 0, shutdownHooked: false, offReconnect: null })

async function checkSessions(streams: Stream[]) {
  const alive = await aliveSessions(streams.map((s) => s.sid))
  if (!alive) return // Redis hiccup: keep going, checked again later
  streams.forEach((s, i) => {
    if (alive[i]) return
    s.send('event: logout\ndata: {}\n\n')
    s.close()
  })
}

/** One timer for the whole process, only while someone is connected. */
function startBeat() {
  if (registry.timer) return
  registry.offReconnect = onBusReconnect(() => registry.streams.forEach((s) => void s.hello()))
  registry.timer = setInterval(() => {
    const streams = [...registry.streams]
    if (streams.length === 0) {
      clearInterval(registry.timer!)
      registry.timer = null
      registry.offReconnect?.()
      return
    }
    streams.forEach((s) => s.send('event: beat\ndata: {}\n\n'))
    void heartbeatStreams(streams)
    if (++registry.beats % SESSION_CHECK_EVERY === 0) void checkSessions(streams)
  }, HEARTBEAT_MS)
  registry.timer.unref?.()
}

/** A deploy or restart closes streams cleanly instead of holding the process until it is killed. */
function hookShutdown() {
  if (registry.shutdownHooked) return
  registry.shutdownHooked = true
  const closeAll = () => [...registry.streams].forEach((s) => s.close())
  process.once('SIGTERM', closeAll)
  process.once('SIGINT', closeAll)
}

export const openStreamCount = () => registry.streams.size

export async function liveStreamResponse(session: SessionData, sid: string, signal: AbortSignal): Promise<Response> {
  const isAgent = isAgentRole(session.role)
  const connectionId = crypto.randomUUID()
  if (!(await openStream(session.userId, connectionId, isAgent))) {
    return NextResponse.json({ error: 'Open in too many windows', code: 'too_many_streams' }, { status: 429 })
  }
  const channels = channelsFor(session)
  const areaOf = new Map(channels.map((c) => [c.channel, c.area]))
  const encoder = new TextEncoder()
  let stop: () => void = () => {}

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let stopListening: () => void = () => {}

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
          if (controller.desiredSize !== null && controller.desiredSize < -MAX_QUEUED) close()
        } catch {
          close()
        }
      }
      const hello = async () => {
        const values = await redis.mget(channels.map((c) => versionKey(c.channel))).catch(() => null)
        // Unknown versions: let the browser assume that everything moved
        const known = Object.fromEntries(channels.map((c, i) => [c.area, values ? Number(values[i] ?? 0) : null]))
        send(`event: hello\ndata: ${JSON.stringify({ versions: known })}\n\n`)
      }
      const stream: Stream = { userId: session.userId, connectionId, isAgent, sid, send, hello, close: () => close() }
      function close() {
        if (closed) return
        closed = true
        registry.streams.delete(stream)
        stopListening()
        void closeStream(session.userId, connectionId)
        try {
          controller.close()
        } catch {
          // already closed by the browser
        }
      }
      stop = close

      registry.streams.add(stream)
      startBeat()
      hookShutdown()
      signal.addEventListener('abort', close)
      // Spread out so that a restart doesn't bring everyone back in the same second
      send(`retry: ${3000 + Math.floor(Math.random() * 4000)}\n\n`)
      const listening = listen(channels.map((c) => c.channel), (event: LiveEvent, version, channel) => {
        if (event.type === 'session') return void checkSessions([stream])
        send(`event: ${event.type}\ndata: ${JSON.stringify(version === null ? event : { ...event, a: areaOf.get(channel), v: version })}\n\n`)
      })
      stopListening = listening.stop
      // Only once Redis confirmed the subscription, so nothing can fall between these versions and the events
      void listening.ready.then(hello)
      if (signal.aborted) close()
    },
    cancel() {
      stop()
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
