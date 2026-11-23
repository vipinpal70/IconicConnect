import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/src/db'
import { profiles, type Profile } from '@/src/db/schema/profile'
import { getCurrentSession } from '@/src/lib/auth/server'
import { rateLimit } from '@/src/lib/security/rate-limit'
import { canUseSupport, type SupportActor } from './policy'

/**
 * Shared plumbing for the support route handlers: authentication, uniform errors, body/query parsing,
 * rate limits. Handlers stay thin: authenticate → validate → call the service → respond.
 */

export type SupportProfile = Pick<Profile, 'id' | 'userType' | 'role' | 'fullName' | 'labName' | 'clientId'>

export class SupportError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export const notFound = () => new SupportError(404, 'not_found', 'Conversation not found')

export function errorResponse(error: unknown) {
  if (error instanceof SupportError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  // Never leak internals (SQL, stack) to the client
  console.error('[support]', error)
  return NextResponse.json({ error: 'Something went wrong. Please try again.', code: 'internal' }, { status: 500 })
}

/** The signed-in user as a support actor, with the profile fields needed for names and the activity log. */
export async function requireSupportActor(): Promise<{ actor: SupportActor; profile: SupportProfile }> {
  const session = await getCurrentSession()
  if (!session) throw new SupportError(401, 'unauthorized', 'Please sign in again')
  const [profile] = await db
    .select({
      id: profiles.id,
      userType: profiles.userType,
      role: profiles.role,
      fullName: profiles.fullName,
      labName: profiles.labName,
      clientId: profiles.clientId,
      status: profiles.status,
    })
    .from(profiles)
    .where(eq(profiles.id, session.userId))
    .limit(1)
  if (!profile || profile.status === 'inactive') throw new SupportError(401, 'unauthorized', 'Please sign in again')
  const actor: SupportActor = { id: profile.id, role: profile.role, clientId: profile.clientId }
  if (!canUseSupport(actor)) throw new SupportError(403, 'forbidden', 'You do not have access to support conversations')
  return { actor, profile }
}

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message || 'Invalid request'
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    throw new SupportError(400, 'invalid_json', 'Request body must be JSON')
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new SupportError(400, 'invalid_request', validationMessage(parsed.error))
  return parsed.data
}

export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams)
  const parsed = schema.safeParse(params)
  if (!parsed.success) throw new SupportError(400, 'invalid_request', validationMessage(parsed.error))
  return parsed.data
}

export function parseId(id: string): string {
  const parsed = z.uuid().safeParse(id)
  if (!parsed.success) throw notFound()
  return parsed.data
}

/** Per-user limits (support-system.md §7). If Redis is down, rateLimit falls back to a per-process counter. */
export const LIMITS = {
  createTicket: { limit: 10, windowSeconds: 60 * 60 },
  message: { limit: 30, windowSeconds: 60 },
  upload: { limit: 20, windowSeconds: 60 * 60 },
} as const

export async function enforceLimit(userId: string, name: keyof typeof LIMITS) {
  const { limit, windowSeconds } = LIMITS[name]
  const result = await rateLimit(`support:${name}:${userId}`, limit, windowSeconds)
  if (result.limited) {
    throw new SupportError(429, 'rate_limited', `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`)
  }
}
