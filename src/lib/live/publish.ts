import { redis } from '@/src/lib/redis'

/**
 * Sending live events (performance-optimization-notification-plan.md §7). Kept apart from the subscriber so
 * code that only publishes, including the worker, opens no extra connection.
 *
 * On the wire: {"v": number|null, "e": event}. `v` counts the events of one version key, so a browser can
 * tell that it missed one.
 */

export const userChannel = (userId: string) => `live:user:${userId}`
export const labChannel = (clientId: string) => `live:lab:${clientId}`
export const staffChannel = 'live:staff'
export const allLabsChannel = 'live:labs'

const PUBLISH_VERSIONED = `
local v = redis.call('INCR', KEYS[1])
return redis.call('PUBLISH', ARGV[1], '{"v":' .. string.format('%d', v) .. ',"e":' .. ARGV[2] .. '}')
`

/** Fire-and-forget: a Redis hiccup must never fail the action that produced the event. */
export async function publishLive(channel: string, event: { type: string }, versionKey?: string): Promise<void> {
  const payload = JSON.stringify(event)
  try {
    if (versionKey) await redis.eval(PUBLISH_VERSIONED, 1, versionKey, channel, payload)
    else await redis.publish(channel, `{"v":null,"e":${payload}}`)
  } catch {
    // The next refresh or reconnect picks the change up
  }
}

/** This person's sessions changed: each of their streams checks whether its own is still valid. */
export const publishSessionCheck = (userId: string) => publishLive(userChannel(userId), { type: 'session' })
