import { redis } from '@/src/lib/redis'
import { allLabsChannel, labChannel, staffChannel, userChannel, versionKey } from './names'

/**
 * Sending live events (performance-optimization-notification-plan.md §7). Kept apart from the subscriber so
 * code that only publishes, including the worker, opens no extra connection.
 *
 * On the wire: {"v": number|null, "e": event}. `v` counts the events of the channel.
 */

const PUBLISH_COUNTED = `
local v = redis.call('INCR', KEYS[1])
return redis.call('PUBLISH', ARGV[1], '{"v":' .. string.format('%d', v) .. ',"e":' .. ARGV[2] .. '}')
`

/**
 * Fire-and-forget: a Redis hiccup must never fail the action that produced the event.
 * `counted: false` for what needs no catching up when missed (typing).
 */
export async function publishLive(channel: string, event: { type: string }, opts: { counted?: boolean } = {}): Promise<void> {
  const payload = JSON.stringify(event)
  try {
    if (opts.counted === false) await redis.publish(channel, `{"v":null,"e":${payload}}`)
    else await redis.eval(PUBLISH_COUNTED, 1, versionKey(channel), channel, payload)
  } catch {
    // The next refresh or reconnect picks the change up
  }
}

/** This person's sessions changed: each of their streams checks whether its own is still valid. */
export const publishSessionCheck = (userId: string) => publishLive(userChannel(userId), { type: 'session' }, { counted: false })

// ── Sidebar dots ──────────────────────────────────────────────────────────────────────────────────

export type BadgeKey = 'cases' | 'clients' | 'billing' | 'offers' | 'tutorials'

/** Light a dot for everyone on staff, one lab, or all labs: there is certainly something new. */
export const lightStaffBadge = (key: BadgeKey) => publishLive(staffChannel, { type: 'badge', key, on: true } as { type: string })
export const lightLabBadge = (clientId: string, key: BadgeKey) => publishLive(labChannel(clientId), { type: 'badge', key, on: true } as { type: string })
export const lightAllLabsBadge = (key: BadgeKey) => publishLive(allLabsChannel, { type: 'badge', key, on: true } as { type: string })
/** One person opened the page: off on all their devices. */
export const clearUserBadge = (userId: string, key: string) => publishLive(userChannel(userId), { type: 'badge', key, on: false } as { type: string })
/** Whether the dot is on depends on more than this change: let the lab's browsers ask. */
export const recheckLabBadges = (clientId: string) => publishLive(labChannel(clientId), { type: 'badge' })
