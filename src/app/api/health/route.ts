import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { db } from '@/src/db'
import { redis, guarded } from '@/src/lib/redis'
import { describeDbError } from '@/src/lib/db-error'

/**
 * GET /api/health — "is this deployment wired up correctly?" in one request, from any browser or `curl`.
 *   public answer : { ok, db, redis, schema }            (booleans only — safe to expose)
 *   detailed      : send header  x-health-token: <HEALTH_TOKEN env>  to also get timings, applied/expected
 *                   migration counts and the precise failure reason of each check.
 * HTTP 200 when everything is fine, 503 otherwise (so uptime monitors and load balancers can use it too).
 */
export const dynamic = 'force-dynamic'

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
  const t = performance.now()
  try { const value = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout after 4s')), 4000))]); return { ok: true, ms: Math.round(performance.now() - t), value } }
  catch (e) { const d = describeDbError(e); return { ok: false, ms: Math.round(performance.now() - t), error: `${d.kind}${d.code ? ` [${d.code}]` : ''}: ${d.message}` } }
}

export async function GET(req: NextRequest) {
  const dbCheck = await timed(async () => { await db.execute(sql`select 1`) })
  const redisCheck = await timed(async () => { if ((await guarded(() => redis.ping())) !== 'PONG') throw new Error('unexpected PING reply') })

  // Schema: every dbmate migration file shipped with this build must be recorded as applied.
  let expected: number | null = null
  try { expected = fs.readdirSync(path.join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).length } catch { /* files not shipped */ }
  const schemaCheck = await timed(async () => {
    const rows = (await db.execute(sql`select count(*)::int as n from schema_migrations`)) as unknown as Array<{ n: number }>
    return Number(rows[0]?.n ?? 0)
  })
  const applied = schemaCheck.value ?? null
  const schemaOk = schemaCheck.ok && (expected === null || (applied !== null && applied >= expected))

  const ok = dbCheck.ok && redisCheck.ok && schemaOk
  const body: Record<string, unknown> = { ok, db: dbCheck.ok, redis: redisCheck.ok, schema: schemaOk }

  const token = process.env.HEALTH_TOKEN
  if (token && req.headers.get('x-health-token') === token) {
    body.details = {
      db: { ms: dbCheck.ms, error: dbCheck.error },
      redis: { ms: redisCheck.ms, error: redisCheck.error },
      schema: { applied, expected, error: schemaCheck.error, hint: schemaOk ? undefined : 'run: npm run db:deploy' },
      node: process.version, uptimeSeconds: Math.round(process.uptime()),
    }
  }
  return NextResponse.json(body, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
