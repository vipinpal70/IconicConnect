import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { db } from '../src/db'
import { cases, type CaseTimelineEvent } from '../src/db/schema/case'
import { eq, sql } from 'drizzle-orm'

/**
 * One-off backfill for cases stuck at status='submitted_to_client' whose
 * `submittedToClientAt` was never stamped (see approval-checklist/route.ts fix).
 * Determines the real "submitted to client" date from the case's timeline
 * instead, and auto-approves anything past the 7-day window.
 *
 * Usage:
 *   npx tsx scripts/backfill-auto-approve-stale-cases.ts            (dry run — no writes)
 *   npx tsx scripts/backfill-auto-approve-stale-cases.ts --apply    (writes changes)
 */

const AUTO_APPROVE_DAYS = 7
const SUBMITTED_LABEL = 'Submitted for client approval'

function resolveSubmittedDate(c: typeof cases.$inferSelect): { date: Date; source: 'timeline' | 'updatedAt' } {
  const timeline = (c.timeline ?? []) as CaseTimelineEvent[]
  const submitEvents = timeline.filter(
    (e) => e.action === 'case.updated' && e.label === SUBMITTED_LABEL
  )

  if (submitEvents.length > 0) {
    const latest = submitEvents.reduce((a, b) =>
      new Date(a.actionAt) > new Date(b.actionAt) ? a : b
    )
    return { date: new Date(latest.actionAt), source: 'timeline' }
  }

  return { date: c.updatedAt, source: 'updatedAt' }
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n=== Backfill: auto-approve stale 'submitted_to_client' cases (${apply ? 'APPLY' : 'DRY RUN'}) ===\n`)

  const threshold = new Date()
  threshold.setDate(threshold.getDate() - AUTO_APPROVE_DAYS)

  const pending = await db.select().from(cases).where(eq(cases.status, 'submitted_to_client'))
  console.log(`Found ${pending.length} case(s) with status='submitted_to_client'.\n`)

  let approvedCount = 0
  let skippedRecent = 0
  let failedCount = 0

  for (const c of pending) {
    const label = c.caseNumber ?? c.id
    const { date, source } = resolveSubmittedDate(c)
    const daysSince = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)

    if (date > threshold) {
      skippedRecent++
      console.log(`SKIP    ${label} — last submitted ${date.toISOString()} (${daysSince.toFixed(1)}d ago, source=${source}) — under ${AUTO_APPROVE_DAYS} days`)
      continue
    }

    console.log(`${apply ? 'APPROVE' : 'WOULD APPROVE'} ${label} — last submitted ${date.toISOString()} (${daysSince.toFixed(1)}d ago, source=${source})`)

    if (!apply) {
      approvedCount++
      continue
    }

    try {
      const deliveredTime = new Date()
      const tat = c.startTime
        ? Math.round((deliveredTime.getTime() - c.startTime.getTime()) / 60000)
        : null

      const timelineEvent: CaseTimelineEvent = {
        id: randomUUID(),
        action: 'case.auto_approved',
        label: 'Auto-approved by system',
        actor: 'System',
        actionAt: new Date().toISOString(),
        actionTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      }

      await db
        .update(cases)
        .set({
          status: 'approved',
          autoApproved: true,
          submittedToClientAt: c.submittedToClientAt ?? date,
          deliveredTime,
          tat,
          updatedAt: new Date(),
          timeline: sql`coalesce(${cases.timeline}, '[]'::jsonb) || ${JSON.stringify([timelineEvent])}::jsonb`,
        })
        .where(eq(cases.id, c.id))

      approvedCount++
      console.log(`  -> approved.`)
    } catch (err) {
      failedCount++
      console.error(`  -> FAILED for ${c.id}:`, err)
    }
  }

  console.log(`\n=== Done. ${apply ? 'Approved' : 'Would approve'}: ${approvedCount}. Skipped (recent): ${skippedRecent}. Failed: ${failedCount}. ===\n`)
  if (!apply) {
    console.log(`This was a dry run — no changes were made. Re-run with --apply to write changes.\n`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
