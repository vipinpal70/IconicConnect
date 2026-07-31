import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db'
import { profiles } from '../src/db/schema/profile'
import { preferenceForms } from '../src/db/schema/preference-form'
import { createSystemDefaultPreferenceForm, DEFAULT_PREFERENCE_FORM_NAME } from '../src/lib/preference-forms-server'

/**
 * One-off backfill for existing active clients who have zero preference
 * forms — seeds them with the system default form ("Default Preferences
 * -Iconic") so they don't have to wait for a lazy GET-time creation.
 *
 * Usage:
 *   npx tsx scripts/backfill-default-preference-forms.ts            (dry run — no writes)
 *   npx tsx scripts/backfill-default-preference-forms.ts --apply    (writes changes)
 */

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n=== Backfill: seed "${DEFAULT_PREFERENCE_FORM_NAME}" for existing clients (${apply ? 'APPLY' : 'DRY RUN'}) ===\n`)

  const clients = await db
    .select({ id: profiles.id, labName: profiles.labName, fullName: profiles.fullName, email: profiles.email })
    .from(profiles)
    .where(and(eq(profiles.role, 'client'), eq(profiles.status, 'active')))

  console.log(`Found ${clients.length} active client(s).\n`)

  const existingFormClientIds = await db.selectDistinct({ clientId: preferenceForms.clientId }).from(preferenceForms)
  const clientsWithForms = new Set(existingFormClientIds.map((r) => r.clientId))

  const eligible = clients.filter((c) => !clientsWithForms.has(c.id))
  const skipped = clients.length - eligible.length

  console.log(`Already have forms (skip): ${skipped}`)
  console.log(`Missing forms (${apply ? 'will create' : 'would create'}): ${eligible.length}\n`)

  let createdCount = 0
  let failedCount = 0

  for (const c of eligible) {
    const label = c.labName || c.fullName || c.email || c.id

    if (!apply) {
      console.log(`WOULD CREATE  ${label} (${c.id})`)
      createdCount++
      continue
    }

    try {
      const inserted = await createSystemDefaultPreferenceForm(c.id, null)
      if (inserted) {
        createdCount++
        console.log(`CREATED  ${label} (${c.id})`)
      } else {
        console.log(`SKIP     ${label} (${c.id}) — form already existed (race with lazy create)`)
      }
    } catch (err) {
      failedCount++
      console.error(`FAILED   ${label} (${c.id}):`, err)
    }
  }

  console.log(`\n=== Done. ${apply ? 'Created' : 'Would create'}: ${createdCount}. Skipped (already had forms): ${skipped}. Failed: ${failedCount}. ===\n`)
  if (!apply) {
    console.log(`This was a dry run — no changes were made. Re-run with --apply to write changes.\n`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
