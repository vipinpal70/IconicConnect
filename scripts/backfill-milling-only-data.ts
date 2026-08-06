import 'dotenv/config'
import { db } from '../src/db'
import { profiles, serviceCatalog, clientPriceList, cases } from '../src/db/schema'
import { eq, inArray } from 'drizzle-orm'

/**
 * Consolidated backfill for the Milling Only rollout (see implement-plan.md).
 * Reconciles data that predates the 3-flow model so the new feature works
 * correctly everywhere, WITHOUT touching or discarding anything that
 * already exists:
 *
 *   1. Admin catalog   — insert missing milling_only rows (inactive), one
 *                        per existing category/subCategory. Never touches
 *                        an existing catalog row's price/isActive.
 *   2. Client profiles — fill profiles.enabledServiceTypes only where it's
 *                        NULL/empty. Never overwrites an existing selection.
 *   3. Client pricing  — insert missing client_price_list rows for every
 *                        active catalog item per client. Never touches an
 *                        existing row's price/notes/isEnabled.
 *   4. Case data       — normalize only NULL cases.serviceType to
 *                        'design_only' (defensive; the column already has
 *                        a NOT NULL default, so this should find nothing).
 *
 * Every step is INSERT-missing-only or UPDATE-null-only. Nothing is ever
 * deleted, and no existing non-null value is ever overwritten.
 *
 * Usage:
 *   npx tsx scripts/backfill-milling-only-data.ts            (dry run — no writes)
 *   npx tsx scripts/backfill-milling-only-data.ts --apply    (writes changes)
 */

const apply = process.argv.includes('--apply')

function heading(title: string) {
  console.log(`\n=== ${title} (${apply ? 'APPLY' : 'DRY RUN'}) ===\n`)
}

// ── 1. Admin catalog: seed missing milling_only rows ────────────────────────

async function backfillCatalog() {
  heading('1. Admin catalog — milling_only rows')

  const designOnlyRows = await db.select().from(serviceCatalog).where(eq(serviceCatalog.serviceType, 'design_only'))
  const millingOnlyRows = await db.select().from(serviceCatalog).where(eq(serviceCatalog.serviceType, 'milling_only'))
  const existingKeys = new Set(millingOnlyRows.map((r) => `${r.category}::${r.subCategory}`))

  const missing = designOnlyRows.filter((r) => !existingKeys.has(`${r.category}::${r.subCategory}`))

  console.log(`Found ${designOnlyRows.length} design_only catalog row(s), ${millingOnlyRows.length} existing milling_only row(s).`)
  console.log(`${missing.length} milling_only row(s) missing.\n`)

  for (const row of missing) {
    console.log(`${apply ? 'CREATE' : 'WOULD CREATE'} milling_only row for "${row.category} / ${row.subCategory}" (inactive, default price $${row.defaultPrice})`)
  }

  if (apply && missing.length > 0) {
    await db
      .insert(serviceCatalog)
      .values(
        missing.map((row) => ({
          category: row.category,
          subCategory: row.subCategory,
          serviceType: 'milling_only' as const,
          unitType: row.unitType,
          defaultPrice: row.defaultPrice,
          sortOrder: row.sortOrder,
          isActive: false,
        }))
      )
      .onConflictDoNothing()
  }

  console.log(`\n${apply ? 'Created' : 'Would create'}: ${missing.length}.`)
  return missing.length
}

// ── 2. Client profiles: fill only-empty enabledServiceTypes ────────────────

async function backfillClientProfiles() {
  heading('2. Client profiles — enabledServiceTypes')

  const clients = await db.select().from(profiles).where(eq(profiles.role, 'client'))
  const needsBackfill = clients.filter((c) => !c.enabledServiceTypes || c.enabledServiceTypes.length === 0)

  console.log(`Found ${clients.length} client profile(s), ${needsBackfill.length} with no enabled service types set.\n`)

  for (const client of needsBackfill) {
    const label = client.labName || client.fullName || client.email
    console.log(`${apply ? 'SET' : 'WOULD SET'} ${label} (${client.id}) -> ['design_only']`)
  }

  if (apply) {
    for (const client of needsBackfill) {
      await db
        .update(profiles)
        .set({ enabledServiceTypes: ['design_only'], updatedAt: new Date() })
        .where(eq(profiles.id, client.id))
    }
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'}: ${needsBackfill.length}.`)
  return needsBackfill.length
}

// ── 3. Client pricing: insert missing client_price_list rows ───────────────

async function backfillClientPricing() {
  heading('3. Client price lists — missing rows per active catalog item')

  const clients = await db.select().from(profiles).where(eq(profiles.role, 'client'))
  const activeCatalog = await db.select().from(serviceCatalog).where(eq(serviceCatalog.isActive, true))

  if (activeCatalog.length === 0) {
    console.log('No active catalog items — nothing to seed.')
    return 0
  }

  const existingRows = await db
    .select({ clientId: clientPriceList.clientId, catalogItemId: clientPriceList.catalogItemId })
    .from(clientPriceList)
    .where(
      inArray(
        clientPriceList.clientId,
        clients.map((c) => c.id)
      )
    )

  const existingKeys = new Set(existingRows.map((r) => `${r.clientId}::${r.catalogItemId}`))

  const toInsert: { clientId: string; catalogItemId: string; price: string }[] = []
  for (const client of clients) {
    for (const item of activeCatalog) {
      const key = `${client.id}::${item.id}`
      if (!existingKeys.has(key)) {
        toInsert.push({ clientId: client.id, catalogItemId: item.id, price: item.defaultPrice })
      }
    }
  }

  console.log(`${clients.length} client(s) x ${activeCatalog.length} active catalog item(s) = ${clients.length * activeCatalog.length} expected row(s).`)
  console.log(`${existingRows.length} row(s) already exist. ${toInsert.length} row(s) missing.\n`)

  // Summarize per-client instead of printing every row (can be hundreds).
  const missingByClient = new Map<string, number>()
  for (const row of toInsert) {
    missingByClient.set(row.clientId, (missingByClient.get(row.clientId) ?? 0) + 1)
  }
  const clientById = new Map(clients.map((c) => [c.id, c]))
  for (const [clientId, count] of missingByClient) {
    const client = clientById.get(clientId)
    const label = client?.labName || client?.fullName || client?.email || clientId
    console.log(`${apply ? 'CREATE' : 'WOULD CREATE'} ${count} missing price row(s) for ${label}`)
  }

  if (apply && toInsert.length > 0) {
    // Batch to stay well under typical parameter/row limits.
    const BATCH_SIZE = 500
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE)
      await db.insert(clientPriceList).values(batch).onConflictDoNothing()
    }
  }

  console.log(`\n${apply ? 'Created' : 'Would create'}: ${toInsert.length}.`)
  return toInsert.length
}

// ── 4. Case data: normalize NULL serviceType only ───────────────────────────

async function backfillCaseServiceType() {
  heading('4. Case data — null serviceType normalization')

  // serviceType has a NOT NULL default in the schema, so this is a
  // defensive check against rows that predate that constraint or were
  // inserted via a path that bypassed it (e.g. raw SQL import).
  const allCases = await db.select({ id: cases.id, caseNumber: cases.caseNumber, serviceType: cases.serviceType }).from(cases)
  const needsFix = allCases.filter((c) => !c.serviceType)

  console.log(`Found ${allCases.length} case(s), ${needsFix.length} with a null/missing serviceType.\n`)

  for (const c of needsFix) {
    console.log(`${apply ? 'SET' : 'WOULD SET'} case ${c.caseNumber ?? c.id} -> serviceType = 'design_only'`)
  }

  if (apply) {
    for (const c of needsFix) {
      await db.update(cases).set({ serviceType: 'design_only', updatedAt: new Date() }).where(eq(cases.id, c.id))
    }
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'}: ${needsFix.length}.`)
  return needsFix.length
}

// ── Read-only health report (always runs, never writes) ────────────────────

async function printHealthReport() {
  heading('Health report (read-only)')

  const caseCounts = await db.select({ serviceType: cases.serviceType }).from(cases)
  const byServiceType = new Map<string, number>()
  for (const c of caseCounts) {
    byServiceType.set(c.serviceType, (byServiceType.get(c.serviceType) ?? 0) + 1)
  }
  console.log('Cases by service type:')
  for (const [type, count] of byServiceType) console.log(`  ${type}: ${count}`)

  const clients = await db.select().from(profiles).where(eq(profiles.role, 'client'))
  const flowCounts = new Map<string, number>()
  for (const client of clients) {
    for (const flow of client.enabledServiceTypes ?? []) {
      flowCounts.set(flow, (flowCounts.get(flow) ?? 0) + 1)
    }
  }
  console.log('\nClients with each flow enabled:')
  for (const [flow, count] of flowCounts) console.log(`  ${flow}: ${count} / ${clients.length}`)

  const catalog = await db.select().from(serviceCatalog)
  const catalogByFlow = new Map<string, { active: number; inactive: number }>()
  for (const item of catalog) {
    const entry = catalogByFlow.get(item.serviceType) ?? { active: 0, inactive: 0 }
    if (item.isActive) entry.active++
    else entry.inactive++
    catalogByFlow.set(item.serviceType, entry)
  }
  console.log('\nCatalog rows by flow:')
  for (const [flow, { active, inactive }] of catalogByFlow) {
    console.log(`  ${flow}: ${active} active, ${inactive} inactive`)
  }
}

async function main() {
  console.log(`\nBackfill: Milling Only data reconciliation (${apply ? 'APPLY — writes will be made' : 'DRY RUN — no writes'})`)

  const catalogCount = await backfillCatalog()
  const profileCount = await backfillClientProfiles()
  const pricingCount = await backfillClientPricing()
  const caseCount = await backfillCaseServiceType()

  await printHealthReport()

  console.log(`\n=== Summary ===`)
  console.log(`Catalog rows ${apply ? 'created' : 'to create'}: ${catalogCount}`)
  console.log(`Client profiles ${apply ? 'updated' : 'to update'}: ${profileCount}`)
  console.log(`Client price rows ${apply ? 'created' : 'to create'}: ${pricingCount}`)
  console.log(`Cases ${apply ? 'updated' : 'to update'}: ${caseCount}`)

  if (!apply) {
    console.log(`\nThis was a dry run — no changes were made. Re-run with --apply to write changes.\n`)
  } else {
    console.log(`\nDone.\n`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})