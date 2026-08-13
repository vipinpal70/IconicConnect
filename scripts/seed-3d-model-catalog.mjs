import 'dotenv/config'
import postgres from 'postgres'

// Run once after migration 0048_model_only_lab.sql has been applied and
// committed. Backfills the 8 new "3D Model" service_catalog rows for
// already-provisioned databases — ensureServiceCatalogSeeded() only seeds
// the catalog from empty, so it won't add these to a database that already
// has the original 23 rows. See 3d-model-implement-plan.md §4.

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
})

const rows = [
  { category: '3D Model', subCategory: 'Full Arch Model', unitType: 'per_case', defaultPrice: '3.50', sortOrder: 24 },
  { category: '3D Model', subCategory: 'Quad Model', unitType: 'per_case', defaultPrice: '3.50', sortOrder: 25 },
  { category: '3D Model', subCategory: 'Contact Model', unitType: 'per_case', defaultPrice: '3.50', sortOrder: 26 },
  { category: '3D Model', subCategory: 'Horse Shoe Model', unitType: 'per_case', defaultPrice: '3.50', sortOrder: 27 },
  { category: '3D Model', subCategory: 'Implant Model', unitType: 'per_case', defaultPrice: '3.50', sortOrder: 28 },
  { category: '3D Model', subCategory: 'Die', unitType: 'per_tooth', defaultPrice: '0.50', sortOrder: 29 },
  { category: '3D Model', subCategory: 'Articulator', unitType: 'per_case', defaultPrice: '0.50', sortOrder: 30 },
  { category: '3D Model', subCategory: 'Drain Holes', unitType: 'per_case', defaultPrice: '0.00', sortOrder: 31 },
]

try {
  let inserted = 0
  for (const row of rows) {
    const result = await sql`
      INSERT INTO "service_catalog" ("category", "sub_category", "service_type", "unit_type", "default_price", "sort_order", "is_active")
      VALUES (${row.category}, ${row.subCategory}, 'design_only', ${row.unitType}, ${row.defaultPrice}, ${row.sortOrder}, true)
      ON CONFLICT ("category", "sub_category", "service_type") DO NOTHING
      RETURNING "id"
    `
    inserted += result.length
  }
  console.log(`Seeded ${inserted} "3D Model" catalog row(s).`)
} catch (error) {
  console.error('Seeding 3D Model catalog failed')
  console.error(error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
