import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import IORedis from 'ioredis'
import { DEFAULT_CATALOG_ITEMS } from '../src/lib/default-catalog'

/**
 * Upgrades a live `master` database to the `phase2-designOnly` schema + data (see plan.md).
 * It does NOT replace `npm run db:migrate` — the schema changes stay in the migrations
 * (0046…0058). This script wraps them: a read-only pre-flight BEFORE migrating, and the data
 * fixes + verification AFTER.
 *
 *   BEFORE db:migrate  →  run with no flags: prints the pre-flight report, saves a row-count
 *                         snapshot, lists pending migrations, flags anything that would make
 *                         migration 0058 abort (milling users/centres, non-Design cases).
 *   AFTER  db:migrate  →  run again: dry-run shows what it would change; --apply writes it.
 *
 * Post-migration data fixes (one transaction, idempotent, never touches existing prices):
 *   1. Complete the service catalog with the default items (3D Model ×8, Implant Bars, …).
 *   2. Allocate every active catalog item a client_price_list row for every client that lacks
 *      one — price = catalog default, except "Implant Bars" which copies that client's own
 *      "Implants / Ti-Base" price + enabled flag (same rule as seed-implant-bars-catalog.mjs).
 *   3. (--apply-default-prices) apply scripts/price-list-seed.json to the DEFAULT catalog
 *      prices. Off by default; overrides default prices only, never a client's own prices.
 * After commit: clears the cached client price lists in Redis (non-fatal) and prints a
 * verification report (compares against the pre-flight snapshot).
 *
 * Usage:
 *   npx tsx scripts/upgrade-master-to-design-only.ts                         (pre-flight / dry run)
 *   npx tsx scripts/upgrade-master-to-design-only.ts --apply --confirm-db <dbname>
 *   optional: --apply-default-prices   --snapshot <file>
 */

const apply = process.argv.includes('--apply')
const applyDefaultPrices = process.argv.includes('--apply-default-prices')
const flag = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const confirmDb = flag('--confirm-db')
const snapshotArg = flag('--snapshot')
const SNAPSHOT_DIR = 'case_data'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}
const dbUrl = new URL(process.env.DATABASE_URL)
const dbName = dbUrl.pathname.replace(/^\//, '')
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })

type Counts = Record<string, number>
const COUNT_TABLES = ['cases', 'profiles', 'invoices', 'case_files', 'case_messages', 'activity_logs', 'support_tickets', 'preference_forms']

const heading = (t: string) => console.log(`\n=== ${t} ===`)
const red: string[] = []
const flagRed = (msg: string) => {
  red.push(msg)
  console.log(`  ✗ ${msg}`)
}

async function tableExists(name: string) {
  const [r] = await sql`select to_regclass(${'public.' + name}) is not null as e`
  return r.e as boolean
}
async function columnExists(table: string, column: string) {
  const [r] = await sql`select exists(select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column}) as e`
  return r.e as boolean
}
async function rowCount(table: string) {
  const [r] = await sql.unsafe(`select count(*)::int as n from "${table}"`)
  return Number(r.n)
}

async function pendingMigrations() {
  const journal = JSON.parse(fs.readFileSync('./src/db/migrations/meta/_journal.json', 'utf8')) as { entries: { tag: string; when: number }[] }
  let last = 0
  let applied = 0
  if (await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as e`.then((r) => r[0].e)) {
    const [r] = await sql`select count(*)::int as n, coalesce(max(created_at), 0)::bigint as last from drizzle.__drizzle_migrations`
    applied = Number(r.n)
    last = Number(r.last)
  }
  return { applied, last, pending: journal.entries.filter((e) => e.when > last).map((e) => e.tag) }
}

async function snapshot(): Promise<Counts> {
  const out: Counts = {}
  for (const t of COUNT_TABLES) if (await tableExists(t)) out[t] = await rowCount(t)
  return out
}

// ── Phase A: pre-flight (read-only) ─────────────────────────────────────────
async function preflight() {
  heading(`Pre-flight on database "${dbName}" @ ${dbUrl.hostname}`)

  const mig = await pendingMigrations()
  console.log(`Applied migrations: ${mig.applied}; pending in journal: ${mig.pending.length ? mig.pending.join(', ') : 'none'}`)

  const milling = await tableExists('milling_centers')
  const hasCaseServiceType = await columnExists('cases', 'service_type')
  const hasCatalogServiceType = await columnExists('service_catalog', 'service_type')
  // 'pre' = migrations still pending (the data fixes need the new schema); 'post' = fully migrated.
  const state = mig.pending.length > 0 ? 'pre' : 'post'
  console.log(`Schema state: milling tables ${milling ? 'present' : 'absent'}; cases.service_type ${hasCaseServiceType ? 'present' : 'absent'}; service_catalog.service_type ${hasCatalogServiceType ? 'present' : 'absent'}`)

  // Objects the app needs that are NOT in master's drizzle journal (0033/0034/0035 exist as files but were
  // never journaled), so db:migrate will not create them — they must already exist on this database.
  if (!(await tableExists('invoices'))) flagRed('table "invoices" is missing (migrations 0033/0034 are not in the drizzle journal — apply them manually first).')
  const [pc] = await sql`select exists(select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'unit_type' and e.enumlabel = 'per_case') as e`
  if (!pc.e) flagRed("enum value unit_type 'per_case' is missing (migration 0035 is not in the drizzle journal — apply it manually first).")

  // Anything that would make migration 0058 abort
  if (await tableExists('milling_centers')) {
    const n = await rowCount('milling_centers')
    if (n > 0) flagRed(`${n} milling centre(s) exist — 0058 will abort. Convert/export them first (see plan.md §4).`)
  }
  const [mp] = await sql`select count(*)::int as n from profiles where user_type::text = 'milling_portal' or user_role::text like 'milling\\_%'`
  if (Number(mp.n) > 0) flagRed(`${mp.n} milling portal profile(s) exist — 0058 will abort.`)
  if (hasCaseServiceType) {
    const [c] = await sql`select count(*)::int as n from cases where service_type::text <> 'design_only'`
    if (Number(c.n) > 0) flagRed(`${c.n} case(s) are not design_only — 0058 will abort.`)
  }
  const [cs] = await sql`select count(*)::int as n from cases where status::text in ('ready_for_milling','milling_in_progress','milling_qc','packaging','dispatched')`
  if (Number(cs.n) > 0) flagRed(`${cs.n} case(s) are in a milling status — 0058 will abort.`)

  // Catalog health
  const dupSql = hasCatalogServiceType
    ? sql`select category, sub_category, count(*)::int as n from service_catalog where service_type::text = 'design_only' group by 1,2 having count(*) > 1`
    : sql`select category, sub_category, count(*)::int as n from service_catalog group by 1,2 having count(*) > 1`
  const dups = await dupSql
  if (dups.length > 0) flagRed(`${dups.length} duplicate (category, sub_category) pair(s) in service_catalog — the unique key restored by 0058 would fail.`)
  if (hasCatalogServiceType) {
    const rows = await sql`select service_type::text as t, count(*)::int as n from service_catalog group by 1 order by 1`
    console.log('service_catalog rows by service_type:', rows.map((r) => `${r.t}=${r.n}`).join(', '))
    console.log('  (non-design_only rows are deleted by migration 0058)')
  }

  const counts = await snapshot()
  console.log('Row counts:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', '))
  if (red.length === 0) console.log('  ✓ no red flags')

  return { state, counts, pending: mig.pending }
}

// ── Phase B: data fixes (transactional) ─────────────────────────────────────
async function dataFixes() {
  heading(`Data fixes (${apply ? 'APPLY' : 'DRY RUN — rolled back'})`)
  const report: Record<string, number> = {}
  class DryRun extends Error {}
  try {
    await sql.begin(async (tx) => {
      // 1. complete catalog
      let added = 0
      for (const it of DEFAULT_CATALOG_ITEMS) {
        const r = await tx`
          insert into service_catalog (category, sub_category, unit_type, default_price, sort_order)
          values (${it.category}, ${it.subCategory}, ${it.unitType}, ${it.defaultPrice}, ${it.sortOrder})
          on conflict (category, sub_category) do nothing returning id`
        added += r.length
      }
      report['catalog rows added'] = added

      // 2. allocate to every client (never modifies an existing row)
      const alloc = await tx`
        insert into client_price_list (client_id, catalog_item_id, price, is_enabled)
        select p.id, sc.id,
               coalesce(case when sc.category = 'Implant Bars' then ref_cpl.price end, sc.default_price),
               coalesce(case when sc.category = 'Implant Bars' then ref_cpl.is_enabled end, true)
        from profiles p
        cross join service_catalog sc
        left join service_catalog ref on ref.category = 'Implants' and ref.sub_category = 'Ti-Base'
        left join client_price_list ref_cpl on ref_cpl.client_id = p.id and ref_cpl.catalog_item_id = ref.id
        where p.user_role = 'client' and p.user_status <> 'pending' and sc.is_active
        on conflict (client_id, catalog_item_id) do nothing
        returning id`
      report['client price-list rows added'] = alloc.length

      // 3. optional default prices from price-list-seed.json
      if (applyDefaultPrices) {
        const file = JSON.parse(fs.readFileSync(path.join('scripts', 'price-list-seed.json'), 'utf8')) as {
          design_only?: { category: string; subCategory: string; unitType: string; defaultPrice: number; isActive?: boolean; sortOrder?: number }[]
        }
        let changed = 0
        for (const r of file.design_only ?? []) {
          const res = await tx`
            insert into service_catalog (category, sub_category, unit_type, default_price, sort_order, is_active)
            values (${r.category}, ${r.subCategory}, ${r.unitType}, ${r.defaultPrice.toFixed(2)}, ${r.sortOrder ?? 0}, ${r.isActive ?? true})
            on conflict (category, sub_category) do update
              set unit_type = excluded.unit_type, default_price = excluded.default_price,
                  sort_order = excluded.sort_order, is_active = excluded.is_active, updated_at = now()
              where (service_catalog.unit_type, service_catalog.default_price, service_catalog.sort_order, service_catalog.is_active)
                    is distinct from (excluded.unit_type, excluded.default_price, excluded.sort_order, excluded.is_active)
            returning id`
          changed += res.length
        }
        report['default catalog prices created/updated'] = changed
      }

      for (const [k, v] of Object.entries(report)) console.log(`  ${k}: ${v}`)
      if (!apply) throw new DryRun()
    })
  } catch (e) {
    if (!(e instanceof DryRun)) throw e
    console.log('  (dry run — nothing written)')
  }
  return report
}

// ── Phase C: after commit ───────────────────────────────────────────────────
async function clearRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  const redis = new IORedis(url, {
    tls: url.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  })
  redis.on('error', () => {})
  try {
    await redis.connect()
    let cursor = '0'
    let removed = 0
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'price-list:client:*', 'COUNT', 200)
      cursor = next
      if (keys.length) removed += await redis.del(...keys)
    } while (cursor !== '0')
    console.log(`  redis: cleared ${removed} cached client price list(s)`)
  } catch (e) {
    console.log(`  redis: skipped (${e instanceof Error ? e.message : e}) — cached lists expire within 1h anyway`)
  } finally {
    redis.disconnect()
  }
}

async function verify(before: Counts | null) {
  heading('Verification')
  let ok = true
  const check = (label: string, pass: boolean, detail = '') => {
    console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
    if (!pass) ok = false
  }

  check('no milling tables left', !(await tableExists('milling_centers')))
  check('service_catalog.service_type column gone', !(await columnExists('service_catalog', 'service_type')))
  const [missing] = await sql`
    select count(*)::int as n from profiles p cross join service_catalog sc
    where p.user_role = 'client' and p.user_status <> 'pending' and sc.is_active
      and not exists (select 1 from client_price_list c where c.client_id = p.id and c.catalog_item_id = sc.id)`
  check('every non-pending client has a price-list row for every active catalog item', Number(missing.n) === 0, `${missing.n} missing`)
  const [dupe] = await sql`select count(*)::int as n from (select 1 from service_catalog group by category, sub_category having count(*) > 1) d`
  check('no duplicate catalog (category, sub_category)', Number(dupe.n) === 0)

  if (before) {
    const after = await snapshot()
    for (const t of Object.keys(before)) {
      // activity_logs may legitimately shrink/grow; the others must be unchanged
      if (t === 'activity_logs') continue
      check(`${t} row count unchanged`, before[t] === after[t], `${before[t]} → ${after[t]}`)
    }
  } else {
    console.log('  (no pre-flight snapshot found — row-count comparison skipped)')
  }
  console.log(ok ? '\nVerification passed.' : '\nVerification FAILED — review the ✗ lines above.')
  return ok
}

async function main() {
  const pre = await preflight()

  if (pre.state === 'pre') {
    // Migrations still pending: only the pre-flight applies.
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    const file = path.join(SNAPSHOT_DIR, `upgrade-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(file, JSON.stringify({ db: dbName, takenAt: new Date().toISOString(), counts: pre.counts }, null, 2))
    console.log(`\nSnapshot saved: ${file}`)
    console.log(red.length ? '\nResolve the red flags above before running `npm run db:migrate`.' : '\nNext: back up the DB, then run `npm run db:migrate`, then re-run this script.')
    if (apply) {
      console.error('\n--apply refused: migrations are still pending. Run `npm run db:migrate` first.')
      process.exitCode = 1
    }
    return
  }

  // Post-migration
  if (apply && confirmDb !== dbName) {
    console.error(`\n--apply requires --confirm-db ${dbName} (guards against running on the wrong database).`)
    process.exitCode = 1
    return
  }

  let before: Counts | null = null
  const snapFile = snapshotArg ?? (fs.existsSync(SNAPSHOT_DIR)
    ? fs.readdirSync(SNAPSHOT_DIR).filter((f) => f.startsWith('upgrade-snapshot-')).sort().pop()
    : undefined)
  if (snapFile) {
    const full = snapshotArg ? snapFile : path.join(SNAPSHOT_DIR, snapFile)
    const data = JSON.parse(fs.readFileSync(full, 'utf8')) as { db: string; counts: Counts }
    if (data.db === dbName) {
      before = data.counts
      console.log(`\nUsing pre-flight snapshot: ${full}`)
    } else console.log(`\nIgnoring snapshot ${full} (taken on database "${data.db}")`)
  }

  if (apply && red.length > 0) {
    console.error('\n--apply refused: resolve the red flags above first.')
    process.exitCode = 1
    return
  }

  await dataFixes()
  if (apply) {
    heading('Cache')
    await clearRedis()
  }
  if (apply) {
    const ok = await verify(before)
    if (!ok) process.exitCode = 1
  } else {
    console.log('\n(verification report runs after --apply)')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))
