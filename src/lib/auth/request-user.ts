import { getCurrentSession } from './server'

/** Current user for a route handler, straight from the Redis session (kept for existing callers). */
export async function getRequestUser(_unused?: unknown): Promise<{ id: string } | null> {
  const s = await getCurrentSession()
  return s ? { id: s.userId } : null
}
