import { listen } from '@/src/lib/live/bus'
import { presentUsers } from '@/src/lib/live/presence'
import { publishLive } from '@/src/lib/live/publish'
import { agentsChannel, labChannel } from './channels'
import type { SupportSide } from './constants'

/**
 * Live updates for support (support-system.md §11), on the app-wide live connection (src/lib/live).
 *
 * Events are SIGNALS, not data: they carry ids only ("conversation X has a new message"), never message
 * text. The browser then fetches through the normal, access-checked API. So a stream can never leak
 * content, and a lost event only delays an update (Postgres stays the source of truth).
 */

export type SupportEvent =
  | { type: 'message'; ticketId: string; seq: number }
  | { type: 'ticket'; ticketId: string }
  | { type: 'read'; ticketId: string; side: SupportSide; seq: number }
  | { type: 'typing'; ticketId: string; userId: string; name: string; side: SupportSide }

export { agentsChannel, labChannel }
export { MAX_STREAMS_PER_USER, agentsOnline, closeStream, heartbeatStream, openStream } from '@/src/lib/live/presence'

/** Typing is ephemeral: missing it needs no catching up, so it has no version. */
export async function publish(channels: string[], event: SupportEvent): Promise<void> {
  await Promise.all(channels.map((c) => publishLive(c, event, { counted: event.type !== 'typing' })))
}

/** A change everyone involved should see (public message, status, assignment, read receipt). */
export const publishToBoth = (clientId: string, event: SupportEvent) => publish([labChannel(clientId), agentsChannel], event)
/** Agent-only knowledge (internal notes, a note being typed). */
export const publishToAgents = (event: SupportEvent) => publish([agentsChannel], event)

/** Listen on channels; returns an unsubscribe function. */
export function subscribe(channels: string[], listener: (event: SupportEvent) => void): () => void {
  return listen(channels, (event) => listener(event as unknown as SupportEvent)).stop
}

/** Which of these people have the app open in front of them right now. */
export const usersWithOpenStreams = presentUsers
