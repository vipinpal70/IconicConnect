import { NextRequest, NextResponse } from 'next/server'
import { and, asc, count, desc, eq, exists, isNull, not, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/src/db'
import { profiles, users } from '@/src/db/schema/profile'
import { invoices } from '@/src/db/schema/invoice'
import { createClient } from '@/src/lib/auth/server'

/**
 * GET /api/admin/clients/list — searchable, filterable, sortable, paginated client directory.
 *
 *   q        free text; every whitespace-separated term must match one of: lab, contact, email, city, state, phone
 *   status   pending | active | inactive
 *   plan     trial | onboarded
 *   payment  unpaid | paid | none      (unpaid = has an unpaid invoice, paid = has invoices, all paid, none = no invoices)
 *   sort     newest (default) | oldest | name
 *   page / limit   (limit <= 48)
 *
 * Returns { data, total, page, limit, pageCount, facets } where `facets` are the counts each filter chip would
 * show: every facet honours the search and the OTHER filters but ignores itself (so the chips tell you what
 * clicking them would give). Search rides the pg_trgm indexes (idx_profiles_lab_trgm / _name_trgm /
 * idx_users_email_trgm). Not cached: each query is a few milliseconds and any cache would have to be keyed by
 * every filter combination, only to serve stale approvals.
 */
const STATUSES = ['pending', 'active', 'inactive'] as const
const PLANS = ['trial', 'onboarded'] as const
const PAYMENTS = ['unpaid', 'paid', 'none'] as const
const SORTS = ['newest', 'oldest', 'name'] as const
type Status = (typeof STATUSES)[number]
type Plan = (typeof PLANS)[number]

const pick = <T extends readonly string[]>(list: T, v: string | null): T[number] | undefined =>
  v && (list as readonly string[]).includes(v) ? (v as T[number]) : undefined

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function GET(req: NextRequest) {
  try {
    const { data: { user } } = await (await createClient()).auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sp = req.nextUrl.searchParams
    const q = (sp.get('q') ?? '').trim().slice(0, 100)
    const status = pick(STATUSES, sp.get('status'))
    const plan = pick(PLANS, sp.get('plan'))
    const payment = pick(PAYMENTS, sp.get('payment'))
    const sort = pick(SORTS, sp.get('sort')) ?? 'newest'
    const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '24', 10) || 24, 1), 48)
    const page = Math.min(Math.max(parseInt(sp.get('page') ?? '1', 10) || 1, 1), 10_000)

    // ── predicates ──────────────────────────────────────────────────────────
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)
    const search: SQL[] = terms.map((t) => {
      const like = `%${escapeLike(t)}%`
      return or(
        sql`lower(${profiles.labName}) like ${like}`,
        sql`lower(${profiles.fullName}) like ${like}`,
        sql`${users.email}::text ilike ${like}`,
        sql`lower(${profiles.city}) like ${like}`,
        sql`lower(${profiles.state}) like ${like}`,
        sql`${profiles.phone} like ${like}`,
      )!
    })
    const unpaidInvoice = db.select({ one: sql`1` }).from(invoices).where(and(eq(invoices.clientId, profiles.id), eq(invoices.clientPaid, false)))
    const anyInvoice = db.select({ one: sql`1` }).from(invoices).where(eq(invoices.clientId, profiles.id))
    const paymentCond = payment === 'unpaid' ? exists(unpaidInvoice)
      : payment === 'paid' ? and(exists(anyInvoice), not(exists(unpaidInvoice)))
      : payment === 'none' ? not(exists(anyInvoice))
      : undefined

    const base = [eq(profiles.role, 'client'), isNull(profiles.deletedAt), ...search]
    const statusCond = (s?: Status) => (s ? eq(profiles.status, s) : undefined)
    const planCond = (p?: Plan) => (p ? eq(profiles.plan, p) : undefined)

    const orderBy = sort === 'oldest' ? [asc(profiles.createdAt), asc(profiles.id)]
      : sort === 'name' ? [asc(sql`lower(coalesce(nullif(trim(${profiles.labName}), ''), ${profiles.fullName}, ''))`), asc(profiles.id)]
      : [desc(profiles.createdAt), desc(profiles.id)]

    const from = (w: (SQL | undefined)[]) => ({ w: and(...base, ...w) })
    const dataWhere = from([statusCond(status), planCond(plan), paymentCond]).w

    // ── 4 small queries in parallel ────────────────────────────────────────
    const [rows, [{ total }], statusFacet, planFacet] = await Promise.all([
      db.select({
        id: profiles.id, fullName: profiles.fullName, labName: profiles.labName, phone: profiles.phone,
        city: profiles.city, state: profiles.state, status: profiles.status, plan: profiles.plan,
        createdAt: profiles.createdAt, email: users.email,
      }).from(profiles).innerJoin(users, eq(users.id, profiles.id))
        .where(dataWhere).orderBy(...orderBy).limit(limit).offset((page - 1) * limit),
      db.select({ total: count() }).from(profiles).innerJoin(users, eq(users.id, profiles.id)).where(dataWhere),
      db.select({ k: profiles.status, n: count() }).from(profiles).innerJoin(users, eq(users.id, profiles.id))
        .where(from([planCond(plan), paymentCond]).w).groupBy(profiles.status),
      db.select({ k: profiles.plan, n: count() }).from(profiles).innerJoin(users, eq(users.id, profiles.id))
        .where(from([statusCond(status), paymentCond]).w).groupBy(profiles.plan),
    ])

    const tally = (list: readonly string[], got: Array<{ k: string | null; n: number }>) =>
      Object.fromEntries(list.map((k) => [k, Number(got.find((g) => g.k === k)?.n ?? 0)]))

    return NextResponse.json({
      data: rows,
      total: Number(total),
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(Number(total) / limit)),
      facets: { status: tally(STATUSES, statusFacet), plan: tally(PLANS, planFacet) },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[admin/clients/list GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
