import { createHash, randomBytes } from 'node:crypto'
import IORedis from 'ioredis'

export const SESSION_COOKIE = 'iconic_sid'
export const SESSION_TTL_SECONDS = 7 * 60 * 60

export type AuthSession = {
  userId: string
  createdAt: number
}

const sessionKey = (sid: string) =>
  `auth:session:${createHash('sha256').update(sid).digest('hex')}`
const userSessionsKey = (userId: string) =>
  `auth:user-sessions:${userId}`

type RedisTransactionResult = Awaited<ReturnType<ReturnType<IORedis['multi']>['exec']>>

function assertTransactionSucceeded(
  result: RedisTransactionResult,
  operation: string,
): void {
  const failure = result?.find(([error]) => error)?.[0]
  if (!result || failure) {
    throw failure ?? new Error(`Redis ${operation} transaction returned no result.`)
  }
}

let redis: IORedis | undefined

function getRedis(): IORedis {
  if (!redis) {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL is required for authentication sessions')

    redis = new IORedis(url, {
      tls: url.startsWith('rediss://') ? {} : undefined,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      lazyConnect: true,
    })
    redis.on('error', (error) => {
      console.error('[auth session Redis]', error.message)
    })
  }
  return redis
}

export async function createSession(userId: string): Promise<string> {
  const sid = randomBytes(32).toString('base64url')
  const key = sessionKey(sid)
  const redis = getRedis()
  const result = await redis.multi()
    .set(key, JSON.stringify({ userId, createdAt: Date.now() } satisfies AuthSession), 'EX', SESSION_TTL_SECONDS)
    .sadd(userSessionsKey(userId), key)
    .expire(userSessionsKey(userId), SESSION_TTL_SECONDS)
    .exec()
  assertTransactionSucceeded(result, 'session create')
  return sid
}

export async function getSession(sid: string | undefined): Promise<AuthSession | null> {
  if (!sid || !/^[A-Za-z0-9_-]{43}$/.test(sid)) return null
  const raw = await getRedis().get(sessionKey(sid))
  if (!raw) return null

  try {
    const session: unknown = JSON.parse(raw)
    if (
      typeof session === 'object' &&
      session !== null &&
      'userId' in session &&
      typeof session.userId === 'string' &&
      'createdAt' in session &&
      typeof session.createdAt === 'number'
    ) {
      return { userId: session.userId, createdAt: session.createdAt }
    }
  } catch (error) {
    console.error('[auth session] Invalid session record', error)
  }

  await getRedis().del(sessionKey(sid))
  return null
}

export async function destroySession(sid: string | undefined): Promise<void> {
  if (!sid || !/^[A-Za-z0-9_-]{43}$/.test(sid)) return
  const key = sessionKey(sid)
  const session = await getRedis().get(key)
  if (!session) return
  let userId: string
  try {
    const parsed: unknown = JSON.parse(session)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('userId' in parsed) ||
      typeof parsed.userId !== 'string'
    ) {
      await getRedis().del(key)
      return
    }
    userId = parsed.userId
  } catch (error) {
    console.error('[auth session] Invalid session record during destroy', error)
    await getRedis().del(key)
    return
  }
  const result = await getRedis().multi()
    .del(key)
    .srem(userSessionsKey(userId), key)
    .exec()
  assertTransactionSucceeded(result, 'session destroy')
}

export async function destroyAllSessions(userId: string): Promise<void> {
  const redis = getRedis()
  const key = userSessionsKey(userId)
  const sessions = await redis.smembers(key)
  const tx = redis.multi()
  if (sessions.length) tx.del(...sessions)
  tx.del(key)
  const result = await tx.exec()
  assertTransactionSucceeded(result, 'session revoke')
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
}
