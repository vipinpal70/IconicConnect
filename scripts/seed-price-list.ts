import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db'
import { serviceCatalog } from '../src/db/schema'

/**
 * Feeds the system-level DEFAULT price list (service_catalog) — the one
 * behind the admin "Edit Default Price List" modal — from a single editable
 * JSON file covering all three flows (Design Only / Design + Milling /
 * Milling Only). Never touches client_price_list: a client's own prices are
 * untouched no matter what this writes to the default catalog, exactly like
 * the admin UI's own PUT already behaves.
 *
 * For each row in the file, matched by (category, subCategory, serviceType):
 *   - if it already exists in service_catalog, its unitType/defaultPrice/
 *     isActive/sortOrder are OVERRIDDEN with whatever the file says
 *   - if it doesn't exist yet, it's created
 *
 * This is why design_milling and milling_only having zero rows today (no
 * seed script ever wrote design_milling; milling_only's dedicated seed
 * script only creates missing rows and was never re-run after a full DB
 * reset) isn't a schema problem — it's just missing data, which this fixes
 * for all three flows in one place, re-runnable any time prices change.
 *
 * Usage:
 *   npx tsx scripts/seed-price-list.ts                      (dry run — no writes)
 *   npx tsx scripts/seed-price-list.ts --apply               (writes changes)
 *   npx tsx scripts/seed-price-list.ts --file ./my-prices.json --apply
 */

const apply = process.argv.includes('--apply')
const fileFlagIndex = process.argv.indexOf('--file')
const filePath =
  fileFlagIndex !== -1 && process.argv[fileFlagIndex + 1]
    ? path.resolve(process.cwd(), process.argv[fileFlagIndex + 1])
    : path.join(process.cwd(), 'scripts', 'price-list-seed.json')

type ServiceType = 'design_only' | 'design_milling' | 'milling_only'
type UnitType = 'per_tooth' | 'per_arch' | 'per_case'

interface SeedRow {
  category: string
  subCategory: string
  unitType: UnitType
  defaultPrice: number
  isActive?: boolean
  sortOrder?: number
}

const SERVICE_TYPES: ServiceType[] = ['design_only', 'design_milling', 'milling_only']
const UNIT_TYPES: UnitType[] = ['per_tooth', 'per_arch', 'per_case']

function loadFile(): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    console.error(`Failed to parse ${filePath} as JSON:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

function validateRow(raw: unknown, serviceType: ServiceType, index: number): SeedRow | null {
  const row = raw as Partial<SeedRow> | null
  const label = `${serviceType}[${index}]`

  if (!row || typeof row !== 'object') {
    console.error(`  ✗ ${label}: not an object — skipped`)
    return null
  }
  if (typeof row.category !== 'string' || !row.category.trim()) {
    console.error(`  ✗ ${label}: missing "category" — skipped`)
    return null
  }
  if (typeof row.subCategory !== 'string' || !row.subCategory.trim()) {
    console.error(`  ✗ ${label} (${row.category}): missing "subCategory" — skipped`)
    return null
  }
  if (!UNIT_TYPES.includes(row.unitType as UnitType)) {
    console.error(`  ✗ ${label} (${row.category} / ${row.subCategory}): invalid "unitType" "${row.unitType}" — must be one of ${UNIT_TYPES.join(', ')} — skipped`)
    return null
  }
  const price = Number(row.defaultPrice)
  if (!Number.isFinite(price) || price < 0) {
    console.error(`  ✗ ${label} (${row.category} / ${row.subCategory}): invalid "defaultPrice" "${row.defaultPrice}" — skipped`)
    return null
  }

  return {
    category: row.category.trim(),
    subCategory: row.subCategory.trim(),
    unitType: row.unitType as UnitType,
    defaultPrice: price,
    isActive: typeof row.isActive === 'boolean' ? row.isActive : undefined,
    sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : undefined,
  }
}

async function seedServiceType(serviceType: ServiceType, rawRows: unknown[]) {
  console.log(`\n--- ${serviceType} (${rawRows.length} row(s) in file) ---`)

  let created = 0
  let updated = 0
  let unchanged = 0
  let invalid = 0

  for (let i = 0; i < rawRows.length; i++) {
    const row = validateRow(rawRows[i], serviceType, i)
    if (!row) {
      invalid++
      continue
    }

    const [existing] = await db
      .select()
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.category, row.category),
          eq(serviceCatalog.subCategory, row.subCategory),
          eq(serviceCatalog.serviceType, serviceType)
        )
      )
      .limit(1)

    if (existing) {
      const changes: string[] = []
      if (Number(existing.defaultPrice) !== row.defaultPrice) changes.push(`price $${existing.defaultPrice} -> $${row.defaultPrice.toFixed(2)}`)
      if (existing.unitType !== row.unitType) changes.push(`unit ${existing.unitType} -> ${row.unitType}`)
      if (row.isActive !== undefined && existing.isActive !== row.isActive) changes.push(`active ${existing.isActive} -> ${row.isActive}`)
      if (row.sortOrder !== undefined && existing.sortOrder !== row.sortOrder) changes.push(`sort ${existing.sortOrder} -> ${row.sortOrder}`)

      if (changes.length === 0) {
        unchanged++
        continue
      }

      console.log(`  ${apply ? 'UPDATE' : 'WOULD UPDATE'} ${row.category} / ${row.subCategory}: ${changes.join(', ')}`)
      updated++
      if (apply) {
        await db
          .update(serviceCatalog)
          .set({
            unitType: row.unitType,
            defaultPrice: row.defaultPrice.toFixed(2),
            ...(row.isActive !== undefined ? { isActive: row.isActive } : {}),
            ...(row.sortOrder !== undefined ? { sortOrder: row.sortOrder } : {}),
            updatedAt: new Date(),
          })
          .where(eq(serviceCatalog.id, existing.id))
      }
    } else {
      const willBeActive = row.isActive ?? true
      console.log(`  ${apply ? 'CREATE' : 'WOULD CREATE'} ${row.category} / ${row.subCategory} @ $${row.defaultPrice.toFixed(2)} (${willBeActive ? 'active' : 'inactive'})`)
      created++
      if (apply) {
        await db
          .insert(serviceCatalog)
          .values({
            category: row.category,
            subCategory: row.subCategory,
            serviceType,
            unitType: row.unitType,
            defaultPrice: row.defaultPrice.toFixed(2),
            isActive: willBeActive,
            sortOrder: row.sortOrder ?? 0,
          })
          .onConflictDoNothing()
      }
    }
  }

  return { created, updated, unchanged, invalid }
}

async function main() {
  console.log(`\n=== Seed default price list from file (${apply ? 'APPLY — writes will be made' : 'DRY RUN — no writes'}) ===`)
  console.log(`File: ${filePath}`)

  const data = loadFile()
  const totals = { created: 0, updated: 0, unchanged: 0, invalid: 0 }

  for (const serviceType of SERVICE_TYPES) {
    const rawRows = data[serviceType]
    if (!Array.isArray(rawRows)) {
      console.log(`\n--- ${serviceType}: no section in file, skipping ---`)
      continue
    }
    const result = await seedServiceType(serviceType, rawRows)
    totals.created += result.created
    totals.updated += result.updated
    totals.unchanged += result.unchanged
    totals.invalid += result.invalid
  }

  console.log(`\n=== Summary ===`)
  console.log(`${apply ? 'Created' : 'Would create'}: ${totals.created}`)
  console.log(`${apply ? 'Updated' : 'Would update'}: ${totals.updated}`)
  console.log(`Unchanged: ${totals.unchanged}`)
  if (totals.invalid) console.log(`Skipped (invalid rows): ${totals.invalid}`)

  if (!apply) {
    console.log(`\nThis was a dry run — re-run with --apply to write these changes.\n`)
  } else {
    console.log(`\nDone. client_price_list was not touched — existing client prices are unaffected.\n`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
