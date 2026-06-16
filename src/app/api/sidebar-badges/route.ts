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
import { createClient } from '@/src/lib/supabase/server'
import { eq, gt, and, count, sql } from 'drizzle-orm'
import { isValidRoleForType } from '@/src/lib/auth/role'
import { resolveClientId, isLabUser } from '@/src/lib/auth/resolve-client-id'

async function getOne(query: Promise<{ count: number }[]>): Promise<boolean> {
  const [row] = await query
  return Number(row?.count ?? 0) > 0
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    const profile = profileResult[0]
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const seenRows = await db.select().from(sidebarSeenAt).where(eq(sidebarSeenAt.userId, user.id))
    const seenMap = new Map(seenRows.map((r) => [r.pageKey, r.lastSeenAt]))

    // Fall back to the user's account creation date so they only see badges for
    // items that appeared after they joined and that they haven't visited yet.
    const getSince = (key: string): Date => seenMap.get(key) ?? profile.createdAt

    const badge: Record<string, boolean> = {}

    if (isValidRoleForType('admin_portal', profile.role)) {
      // Cases — new cases submitted
      badge.cases = await getOne(
        db.select({ count: count() }).from(cases).where(gt(cases.createdAt, getSince('cases')))
      )

      // Clients — new client registrations (all admin-portal roles can see clients page)
      badge.clients = await getOne(
        db
          .select({ count: count() })
          .from(profiles)
          .where(and(eq(profiles.role, 'client'), gt(profiles.createdAt, getSince('clients'))))
      )

      // Support — new support tickets
      badge.support = await getOne(
        db
          .select({ count: count() })
          .from(supportTickets)
          .where(gt(supportTickets.createdAt, getSince('support')))
      )

      // Billing — new invoices generated
      badge.billing = await getOne(
        db
          .select({ count: count() })
          .from(invoices)
          .where(gt(invoices.createdAt, getSince('billing')))
      )

      // Offers — new offer claims from clients
      badge.offers = await getOne(
        db
          .select({ count: count() })
          .from(offerClaims)
          .where(gt(offerClaims.createdAt, getSince('offers')))
      )

      // Notifications — unread (no last_seen_at needed, just unread count)
      badge.notifications = await getOne(
        db
          .select({ count: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)))
      )
    } else if (isLabUser(profile)) {
      const clientId = resolveClientId(profile)

      // Cases — any case belonging to this lab that has been updated
      badge.cases = await getOne(
        db
          .select({ count: count() })
          .from(cases)
          .where(and(eq(cases.clientId, clientId), gt(cases.updatedAt, getSince('cases'))))
      )

      // Support — own tickets with updates
      badge.support = await getOne(
        db
          .select({ count: count() })
          .from(supportTickets)
          .where(
            and(eq(supportTickets.clientId, clientId), gt(supportTickets.updatedAt, getSince('support')))
          )
      )

      // Billing — new invoices issued to this client
      badge.billing = await getOne(
        db
          .select({ count: count() })
          .from(invoices)
          .where(and(eq(invoices.clientId, clientId), gt(invoices.createdAt, getSince('billing'))))
      )

      // Offers — new active offers published since last visit
      badge.offers = await getOne(
        db
          .select({ count: count() })
          .from(offers)
          .where(and(eq(offers.active, true), gt(offers.createdAt, getSince('offers'))))
      )

      // Tutorials — new tutorials published
      badge.tutorials = await getOne(
        db
          .select({ count: count() })
          .from(tutorials)
          .where(gt(tutorials.createdAt, getSince('tutorials')))
      )

      // Notifications — unread
      badge.notifications = await getOne(
        db
          .select({ count: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)))
      )
    }

    return NextResponse.json(badge)
  } catch (err) {
    console.error('[sidebar-badges GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sidebar-badges PATCH]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
