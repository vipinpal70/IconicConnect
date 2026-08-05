import 'dotenv/config'
import postgres from 'postgres'

// Run once after migration 0047_service_catalog_flows.sql has been applied
// and committed. Seeds a `milling_only` service_catalog row for every
// existing category/subCategory, inactive by default — admin must
// explicitly turn each on and set a price (Milling Only pricing is a new
// commercial decision, not a copy of Design pricing).
//
// Split out from the migration itself because Postgres forbids using an
// enum value added by `ALTER TYPE ... ADD VALUE` within the same
// transaction that added it, and this project's migration runner batches
// every pending migration into a single transaction — see 0047's header
// comment for details.

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
})

try {
  const inserted = await sql`
    INSERT INTO "service_catalog" ("category", "sub_category", "service_type", "unit_type", "default_price", "sort_order", "is_active")
    SELECT DISTINCT ON ("category", "sub_category") "category", "sub_category", 'milling_only', "unit_type", "default_price", "sort_order", false
    FROM "service_catalog"
    WHERE "service_type" = 'design_only'
    ON CONFLICT ("category", "sub_category", "service_type") DO NOTHING
    RETURNING "id"
  `
  console.log(`Seeded ${inserted.length} milling_only catalog row(s).`)
} catch (error) {
  console.error('Seeding milling_only catalog failed')
  console.error(error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}