import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, getSession } from '@/src/lib/auth/session'
import { errorResponse, requireSupportActor } from '@/src/lib/support/http'
import { isAgent } from '@/src/lib/support/policy'
import {
  agentsChannel,
  closeStream,
  heartbeatStream,
  labChannel,
  openStream,
  subscribe,
  type SupportEvent,
} from '@/src/lib/support/realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEARTBEAT_MS = 25_000
const SESSION_CHECK_MS = 5 * 60_000

/**
 * GET: live support events over Server-Sent Events (support-system.md §11).
 *
 * - Staff receive the staff channel; lab people only their lab's channel. Events are ids only.
 * - Every (re)connect starts with `resync`, so the browser refetches whatever it may have missed.
 * - A comment heartbeat every 25 s keeps proxies and tunnels from closing an idle connection, and
 *   `X-Accel-Buffering: no` stops nginx from buffering the stream.
 * - The session is re-checked every 5 minutes; when it's gone the stream says `logout` and closes.
 */
export async function GET(req: NextRequest) {
  let actor
  try {
    ;({ actor } = await requireSupportActor())
  } catch (error) {
    return errorResponse(error)
  }

  const agent = isAgent(actor)
  const channels = agent ? [agentsChannel] : [labChannel(actor.clientId!)]
  const connectionId = crypto.randomUUID()
  if (!(await openStream(actor.id, connectionId, agent))) {
    return NextResponse.json(
      { error: 'Support is open in too many windows. Close a few tabs and try again.', code: 'too_many_streams' },
      { status: 429 },
    )
  }
  const sid = req.cookies.get(SESSION_COOKIE)?.value
  const encoder = new TextEncoder()
  let stop: () => void = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsubscribe: () => void = () => {}
      const timers: { heartbeat?: ReturnType<typeof setInterval>; sessionCheck?: ReturnType<typeof setInterval> } = {}

      const close = () => {
        if (closed) return
        closed = true
        unsubscribe()
        clearInterval(timers.heartbeat)
        clearInterval(timers.sessionCheck)
        void closeStream(actor.id, connectionId)
        try {
          controller.close()
        } catch {
          // already closed by the client
        }
      }
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          close()
        }
      }
      stop = close

      send('retry: 3000\n\n') // browser reconnect delay
      send('event: resync\ndata: {}\n\n')
      unsubscribe = subscribe(channels, (event: SupportEvent) => {
        send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      })
      timers.heartbeat = setInterval(() => {
        send(': ping\n\n')
        void heartbeatStream(actor.id, connectionId, agent)
      }, HEARTBEAT_MS)
      timers.sessionCheck = setInterval(async () => {
        const session = await getSession(sid).catch(() => undefined) // undefined = Redis hiccup, keep going
        if (session === null) {
          send('event: logout\ndata: {}\n\n')
          close()
        }
      }, SESSION_CHECK_MS)
      req.signal.addEventListener('abort', close)
    },
    cancel() {
      stop()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
