import { getCachedData, setCachedData, deleteCachedData } from '@/src/lib/redis-cache'
import { getRequestUser } from '@/src/lib/auth/request-user'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { offers, offerClaims } from '@/src/db/schema/offer'
import { supportTickets } from '@/src/db/schema/support-ticket'
import { invoices } from '@/src/db/schema/invoice'
import { tutorials } from '@/src/db/schema/tutorial'
import { notifications } from '@/src/db/schema/notification'
import { sidebarSeenAt } from '@/src/db/schema/sidebar-seen'
import { createClient } from '@/src/lib/auth/server'
import { eq, gt, and, count, sql } from 'drizzle-orm'
import { isValidRoleForType } from '@/src/lib/auth/role'
import { resolveClientId, isLabUser } from '@/src/lib/auth/resolve-client-id'
import { describeDbError } from '@/src/lib/db-error'

async function getOne(query: Promise<{ count: number }[]>): Promise<boolean> {
  const [row] = await query
  return Number(row?.count ?? 0) > 0
}

export async function GET() {
  try {
    const supabase = await createClient()
    const user = await getRequestUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Per-user (key includes the verified user id) 15s cache: the client polls this every 30s per open tab.
    const cacheKey = `sidebar-badges:${user.id}`
    const cached = await getCachedData<Record<string, boolean>>(cacheKey)
    if (cached) return NextResponse.json(cached)

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    const profile = profileResult[0]
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const seenRows = await db.select().from(sidebarSeenAt).where(eq(sidebarSeenAt.userId, user.id))
    const seenMap = new Map(seenRows.map((r) => [r.pageKey, r.lastSeenAt]))

    // Fall back to the user's account creation date so they only see badges for
    // items that appeared after they joined and that they haven't visited yet.
    const getSince = (key: string): Date => seenMap.get(key) ?? profile.createdAt

    const badge: Record<string, boolean> = {}
    // The badge counts are independent — run them concurrently instead of one Mumbai round trip each.
    // They are also purely cosmetic (a dot on a menu item), so ONE failing count must never take the whole poll
    // down: it degrades to "no dot" for that item, is logged with its real cause, and the rest still render.
    const pending: Promise<void>[] = []
    const degraded: Record<string, ReturnType<typeof describeDbError>> = {}
    const setBadge = (key: string, query: Promise<{ count: number }[]>) => {
      pending.push(getOne(query).then(
        (v) => { badge[key] = v },
        (err) => { badge[key] = false; degraded[key] = describeDbError(err) },
      ))
    }

    if (isValidRoleForType('admin_portal', profile.role)) {
      // Cases — new cases submitted
      setBadge('cases', 
        db.select({ count: count() }).from(cases).where(gt(cases.createdAt, getSince('cases')))
      )

      // Clients — new client registrations (all admin-portal roles can see clients page)
      setBadge('clients', 
        db
          .select({ count: count() })
          .from(profiles)
          .where(and(eq(profiles.role, 'client'), gt(profiles.createdAt, getSince('clients'))))
      )

      // Support — new support tickets
      setBadge('support', 
        db
          .select({ count: count() })
          .from(supportTickets)
          .where(gt(supportTickets.createdAt, getSince('support')))
      )

      // Billing — new invoices generated
      setBadge('billing', 
        db
          .select({ count: count() })
          .from(invoices)
          .where(gt(invoices.createdAt, getSince('billing')))
      )

      // Offers — new offer claims from clients
      setBadge('offers', 
        db
          .select({ count: count() })
          .from(offerClaims)
          .where(gt(offerClaims.createdAt, getSince('offers')))
      )

      // Notifications — unread (no last_seen_at needed, just unread count)
      setBadge('notifications', 
        db
          .select({ count: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, user.id), eq(notifications.read, false), eq(notifications.dismissed, false)))
      )
    } else if (isLabUser(profile)) {
      const clientId = resolveClientId(profile)

      // Cases — any case belonging to this lab that has been updated
      setBadge('cases', 
        db
          .select({ count: count() })
          .from(cases)
          .where(and(eq(cases.clientId, clientId), gt(cases.updatedAt, getSince('cases'))))
      )

      // Support — own tickets with updates
      setBadge('support', 
        db
          .select({ count: count() })
          .from(supportTickets)
          .where(
            and(eq(supportTickets.clientId, clientId), gt(supportTickets.updatedAt, getSince('support')))
          )
      )

      // Billing — new invoices issued to this client
      setBadge('billing', 
        db
          .select({ count: count() })
          .from(invoices)
          .where(and(eq(invoices.clientId, clientId), gt(invoices.createdAt, getSince('billing'))))
      )

      // Offers — new active offers published since last visit
      setBadge('offers', 
        db
          .select({ count: count() })
          .from(offers)
          .where(and(eq(offers.active, true), gt(offers.createdAt, getSince('offers'))))
      )

      // Tutorials — new tutorials published
      setBadge('tutorials', 
        db
          .select({ count: count() })
          .from(tutorials)
          .where(gt(tutorials.createdAt, getSince('tutorials')))
      )

      // Notifications — unread
      setBadge('notifications', 
        db
          .select({ count: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, user.id), eq(notifications.read, false), eq(notifications.dismissed, false)))
      )
    }

    await Promise.all(pending)
    const failed = Object.keys(degraded)
    if (failed.length) {
      console.error('[sidebar-badges GET] degraded badges:', JSON.stringify(degraded))
      // Do not cache a partial answer for the full TTL; retry soon.
      await setCachedData(cacheKey, badge, 3)
      return NextResponse.json(badge, { headers: { 'X-Badge-Degraded': failed.join(',') } })
    }
    await setCachedData(cacheKey, badge, 15)
    return NextResponse.json(badge)
  } catch (err) {
    // Core failure (session store, profile lookup, …). Say WHY in the log (code + Postgres message, no SQL params)
    // and tell clients to back off briefly instead of hammering a struggling backend.
    const info = describeDbError(err)
    console.error('[sidebar-badges GET] FAILED:', JSON.stringify(info))
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '15' } })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { page } = body as { page?: string }
    if (!page || typeof page !== 'string') {
      return NextResponse.json({ error: 'page is required' }, { status: 400 })
    }

    await db
      .insert(sidebarSeenAt)
      .values({ userId: user.id, pageKey: page, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: [sidebarSeenAt.userId, sidebarSeenAt.pageKey],
        set: { lastSeenAt: sql`now()` },
      })

    // The badge for this page just cleared — don't serve the stale cached copy.
    await deleteCachedData(`sidebar-badges:${user.id}`)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sidebar-badges PATCH]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
