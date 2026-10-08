// Latency diagnosis — run it ON THE SERVER, in the project folder:
//
//   node scripts/diagnose-latency.mjs
//
// It only reads: `select`s against the database, a PING to Redis, health calls to Supabase Auth and a
// few GETs to the local app. It tells you which hop is slow (server <-> Supabase DB, Supabase Auth,
// Redis, or the app itself) and where the server is relative to the Supabase region.
import 'dotenv/config'
import postgres from 'postgres'
import IORedis from 'ioredis'

const ms = (n) => `${n.toFixed(0)}ms`
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y)
  return { min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1] }
}
const line = (label, a) => {
  const { min, med, max } = stats(a)
  console.log(`  ${label.padEnd(34)} min ${ms(min).padStart(6)}   median ${ms(med).padStart(6)}   max ${ms(max).padStart(6)}`)
  return stats(a)
}
async function time(fn, n = 10) {
  const out = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    await fn()
    out.push(performance.now() - t)
  }
  return out
}
const verdicts = []

console.log('\n=== 1. Where is this server, where is Supabase? ===')
const dbUrl = process.env.DATABASE_URL
if (!dbUrl) { console.error('DATABASE_URL missing'); process.exit(1) }
const dbHost = new URL(dbUrl).hostname
const region = (dbHost.match(/aws-\d+-([a-z0-9-]+)\.pooler/) || [])[1]
console.log(`  Supabase DB host : ${dbHost}`)
console.log(`  Supabase region  : ${region ?? '(unknown — check dashboard)'}`)
try {
  const r = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(4000) })
  const j = await r.json()
  console.log(`  This server      : ${j.city}, ${j.region}, ${j.country}  (${j.ip}, ${j.org})`)
} catch { console.log('  This server      : (could not look up location)') }

console.log('\n=== 2. Database round trips (server -> Supabase) ===')
const sql = postgres(dbUrl, { prepare: false, max: 1 })
await sql`select 1` // warm the connection
const rtt = line('select 1 (pure network round trip)', await time(() => sql`select 1`, 15))
line('count(*) from cases', await time(() => sql`select count(*) from cases`, 8))
line('cases page: newest 101 rows', await time(() => sql`select id, case_number, status, created_at, sub_type_data from cases order by created_at desc, id desc limit 101`, 8))
line('profile by id (what every request does)', await time(() => sql`select * from profiles limit 1`, 8))
const [{ n }] = await sql`select count(*)::int as n from pg_stat_activity where datname = current_database()`
console.log(`  open connections to this database right now: ${n}`)
await sql.end()
if (rtt.med > 100) verdicts.push(`DB round trip is ${ms(rtt.med)}. Every query pays this: a page doing 6 sequential queries costs ~${ms(rtt.med * 6)} before any real work. Move the server (or the Supabase project) into the SAME region.`)
else if (rtt.med > 40) verdicts.push(`DB round trip is ${ms(rtt.med)} — acceptable, but not same-region fast (<10ms).`)

console.log('\n=== 3. Supabase Auth (the proxy calls it on every request) ===')
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (supaUrl) {
  try {
    const a = await time(() => fetch(`${supaUrl}/auth/v1/health`, { headers: anon ? { apikey: anon } : {} }).then((r) => r.text()), 10)
    const st = line('GET /auth/v1/health', a)
    if (st.med > 150) verdicts.push(`Supabase Auth round trip is ${ms(st.med)} and the proxy pays it on EVERY request (auth.getUser). Fix: same region, and/or cache the verified user briefly in the proxy.`)
  } catch (e) { console.log('  failed:', e.message) }
} else console.log('  NEXT_PUBLIC_SUPABASE_URL not set')

console.log('\n=== 4. Redis ===')
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const rHost = (() => { try { return new URL(redisUrl).host } catch { return redisUrl } })()
console.log(`  REDIS_URL host: ${rHost}`)
const redis = new IORedis(redisUrl, { tls: redisUrl.startsWith('rediss://') ? {} : undefined, maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true, connectTimeout: 2000 })
redis.on('error', () => {})
try {
  await redis.connect()
  const st = line('PING', await time(() => redis.ping(), 15))
  if (st.med > 20) verdicts.push(`Redis PING is ${ms(st.med)} — Redis should answer in ~1ms on the same machine. Check REDIS_URL.`)
} catch (e) {
  console.log(`  ✗ cannot reach Redis (${e.message})`)
  verdicts.push('Redis is unreachable from the app — no caching at all, every request goes to the database. Fix REDIS_URL in the server .env.')
} finally { redis.disconnect() }

console.log('\n=== 5. The app itself (local, no login) ===')
const base = process.env.DIAG_APP_URL || 'http://127.0.0.1:4000'
for (const path of ['/auth/sign-in', '/api/sidebar-badges']) {
  try {
    const a = await time(() => fetch(base + path, { redirect: 'manual' }).then((r) => r.arrayBuffer()), 6)
    line(`GET ${path}`, a)
  } catch (e) { console.log(`  GET ${path}: failed (${e.message}) — is the app running on ${base}?`) }
}
console.log('  (a logged-in request additionally pays the Supabase Auth + profile costs measured above)')

console.log('\n=== Verdict ===')
if (!verdicts.length) console.log('  No obvious network problem from this server. Open DevTools → Network on a slow page and read the Server-Timing header / the slowest request.')
for (const v of verdicts) console.log('  • ' + v)
console.log()
