import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { notifications } from '@/src/db/schema/notification'
import { userChannel } from '@/src/lib/live/names'
import { publishLive } from '@/src/lib/live/publish'
import { redis } from '@/src/lib/redis'

/**
 * Call after these people's notifications changed in any way (created, read, edited, removed): clears what is
 * cached and tells their open tabs, which update the bell without asking.
 */
export async function notificationsChanged(userIds: Iterable<string>, opts: { created?: boolean } = {}): Promise<void> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return
  try {
    if (redis.status === 'ready') {
      await redis.del(
        ...ids.flatMap((id) => [
          `notifications:${id}:unread`,
          `notifications:${id}:list:20:0`,
          `notifications:${id}:list:5:0`,
          `sidebar-badges:${id}`,
        ]),
      )
    }
    const unread = opts.created
      ? new Set(ids)
      : new Set(
          (
            await db
              .selectDistinct({ id: notifications.userId })
              .from(notifications)
              .where(and(inArray(notifications.userId, ids), eq(notifications.read, false), eq(notifications.dismissed, false)))
          ).map((r) => r.id),
        )
    await Promise.all(ids.map((id) => publishLive(userChannel(id), { type: 'notification', unread: unread.has(id) } as { type: string })))
  } catch (err) {
    console.error('[notificationsChanged]', (err as Error).message)
  }
}
