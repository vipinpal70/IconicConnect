import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, lt, type SQL } from 'drizzle-orm'
import { db } from '@/src/db'
import { authAuditLog } from '@/src/db/schema/auth-audit'
import { createClient } from '@/src/lib/auth/server'

/**
 * GET /api/admin/security/audit?userId=&email=&event=&before=<id>&limit=50
 * Admin-only, read-only, keyset-paginated (newest first) — served by idx_audit_user_time / idx_audit_email_time /
 * idx_audit_event_time. Role is taken from the Redis session, never from the request.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT = /^[a-z][a-z0-9_]{2,63}$/

export async function GET(req: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = req.nextUrl.searchParams
  const userId = q.get('userId'); const email = q.get('email')?.trim().toLowerCase(); const event = q.get('event'); const before = q.get('before')
  if (userId && !UUID.test(userId)) return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
  if (event && !EVENT.test(event)) return NextResponse.json({ error: 'Invalid event' }, { status: 400 })
  if (before && !/^\d{1,18}$/.test(before)) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
  const limit = Math.min(Math.max(parseInt(q.get('limit') ?? '50', 10) || 50, 1), 100)

  const where: (SQL | undefined)[] = [
    userId ? eq(authAuditLog.userId, userId) : undefined,
    email ? eq(authAuditLog.email, email) : undefined,
    event ? eq(authAuditLog.event, event) : undefined,
    before ? lt(authAuditLog.id, Number(before)) : undefined,
  ]
  const rows = await db.select().from(authAuditLog).where(and(...where)).orderBy(desc(authAuditLog.id)).limit(limit + 1)
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  return NextResponse.json({ data, nextCursor: hasMore ? String(data[data.length - 1].id) : null })
}
