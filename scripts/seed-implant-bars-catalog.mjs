import 'dotenv/config'
import postgres from 'postgres'
import IORedis from 'ioredis'

// Backfills the "Implant Bars" category into an already-provisioned database.
//
//   1. service_catalog: one "Implant Bars / Implant Bars" row per flow
//      (design_only, design_milling, milling_only). Price and active state are
//      mirrored from that flow's "Implants / Ti-Base" row so Implant Bars starts
//      "same as Implants"; falls back to 4.00 / active (milling_only: inactive)
//      when the Ti-Base row is missing.
//   2. client_price_list: a row for every client (lab) for each flow they have
//      enabled. Price and isEnabled are copied from that client's own
//      "Implants / Ti-Base" row (so a lab with Implants switched off doesn't
//      silently get Implant Bars), falling back to the catalog price / enabled.
//   3. Redis: drops the cached client price lists (1h TTL) so labs see the new
//      category immediately.
//
// Idempotent — existing rows are never touched. Dry run by default:
//   node scripts/seed-implant-bars-catalog.mjs          (preview)
//   node scripts/seed-implant-bars-catalog.mjs --apply  (write)

const APPLY = process.argv.includes('--apply')
const CATEGORY = 'Implant Bars'
const SUB_CATEGORY = 'Implant Bars'
const FLOWS = ['design_only', 'design_milling', 'milling_only']

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })

try {
  console.log(APPLY ? 'APPLY mode — writing changes' : 'DRY RUN — no changes will be written (pass --apply)')

  await sql.begin(async (tx) => {
    // 1. Catalog rows
    const catalogToAdd = []
    for (const flow of FLOWS) {
      const [existing] = await tx`
        SELECT id FROM service_catalog
        WHERE category = ${CATEGORY} AND sub_category = ${SUB_CATEGORY} AND service_type = ${flow}`
      if (existing) continue
      const [ref] = await tx`
        SELECT default_price, is_active FROM service_catalog
        WHERE category = 'Implants' AND sub_category = 'Ti-Base' AND service_type = ${flow}`
      catalogToAdd.push({
        flow,
        price: ref?.default_price ?? '4.00',
        active: ref?.is_active ?? flow !== 'milling_only',
      })
    }
    for (const r of catalogToAdd) {
      console.log(`  catalog: + ${r.flow} @ ${r.price} (${r.active ? 'active' : 'inactive'})`)
      if (APPLY) {
        await tx`
          INSERT INTO service_catalog (category, sub_category, service_type, unit_type, default_price, sort_order, is_active)
          VALUES (${CATEGORY}, ${SUB_CATEGORY}, ${r.flow}, 'per_tooth', ${r.price}, 32, ${r.active})
          ON CONFLICT (category, sub_category, service_type) DO NOTHING`
      }
    }
    if (catalogToAdd.length === 0) console.log('  catalog: already present for all flows')

    // 2. Client price-list rows (in dry run, catalog rows may not exist yet — count by join on what exists
    //    plus the flows that would be added)
    if (APPLY) {
      const inserted = await tx`
        INSERT INTO client_price_list (client_id, catalog_item_id, price, is_enabled)
        SELECT p.id, bars.id,
               COALESCE(ref_cpl.price, bars.default_price),
               COALESCE(ref_cpl.is_enabled, true)
        FROM profiles p
        JOIN service_catalog bars
          ON bars.category = ${CATEGORY} AND bars.sub_category = ${SUB_CATEGORY}
         AND bars.service_type::text = ANY (COALESCE(p.enabled_service_types::text[], ARRAY['design_only']))
        LEFT JOIN service_catalog ref
          ON ref.category = 'Implants' AND ref.sub_category = 'Ti-Base' AND ref.service_type = bars.service_type
        LEFT JOIN client_price_list ref_cpl
          ON ref_cpl.client_id = p.id AND ref_cpl.catalog_item_id = ref.id
        WHERE p.user_role = 'client'
        ON CONFLICT (client_id, catalog_item_id) DO NOTHING
        RETURNING id`
      console.log(`  client price lists: + ${inserted.length} row(s)`)
    } else {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM profiles WHERE user_role = 'client'`
      console.log(`  client price lists: would add rows for up to ${n} client(s) (per enabled flow)`)
    }
  })

  // 3. Cache — best-effort: the DB changes above are already committed, so a
  // Redis outage must not fail the run (cached lists just expire within 1h).
  if (APPLY && process.env.REDIS_URL) {
    const redis = new IORedis(process.env.REDIS_URL, {
      tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
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
    } catch (err) {
      console.warn(`  redis: could not clear cache (${err.message}). Cached lists expire within 1 hour,`)
      console.warn('         or re-run this script once Redis is reachable (it is idempotent).')
    } finally {
      redis.disconnect()
    }
  } else if (APPLY) {
    console.log('  redis: REDIS_URL not set — cached lists expire within 1 hour')
  }
} catch (error) {
  console.error('Seeding Implant Bars catalog failed')
  console.error(error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
