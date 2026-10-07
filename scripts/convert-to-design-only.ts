import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../src/db'
import {
  profiles,
  cases,
  caseFiles,
  casePreviewFiles,
  caseReferenceFiles,
  caseHoldFiles,
  caseMessages,
  chatMessages,
  notifications,
  activityLogs,
  serviceCatalog,
  clientPriceList,
  millingCenters,
  millingServiceCatalog,
  millingRoutingRules,
  millingCaseAssignments,
  caseCenterAssignmentHistory,
} from '../src/db/schema'
import { and, count, eq, inArray, like, ne, or, sql } from 'drizzle-orm'

/**
 * Phase 2 of design-only-removal-plan.md — converts existing data to the
 * Design-only product. Run AFTER Phase 1 is deployed (nothing new can enter a
 * milling flow) and BEFORE the Phase 3 deletions.
 *
 *   1. Cases      — service_type -> 'design_only', design_source -> 'internal'.
 *                   Milling-pipeline statuses are mapped:
 *                     ready_for_milling / milling_in_progress / milling_qc / packaging -> approved
 *                     dispatched                                                    -> delivered
 *                   One activity_logs row (case.converted_to_design_only) per case touched.
 *   2. Pricing    — deletes service_catalog rows whose service_type <> 'design_only'
 *                   (client_price_list rows cascade).
 *   3. Clients    — profiles.enabled_service_types -> {design_only}.
 *   4. Notifications whose link points into /milling/*.
 *   5. Milling data — exports milling tables to CSV, then deletes: assignments,
 *                   assignment history, routing rules, service catalog, milling_portal
 *                   profiles, centres. Content a milling user authored on cases
 *                   (files, case/chat messages) is re-pointed to --admin; their
 *                   activity_logs rows are deleted.
 *   6. After the DB transaction commits: deletes centre contract docs from R2 and the
 *                   milling users' Supabase Auth accounts.
 *
 * Schema (tables/columns/enum values) is NOT touched — that is Phase 7.
 *
 * Usage:
 *   npx tsx scripts/convert-to-design-only.ts                                  (dry run — no writes)
 *   npx tsx scripts/convert-to-design-only.ts --apply --admin <adminProfileId> (writes changes)
 *   optional: --export-dir <dir>   (default: case_data/milling-archive-<timestamp>, gitignored)
 */

const apply = process.argv.includes('--apply')
const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const adminId = argValue('--admin')
const exportDir =
  argValue('--export-dir') ??
  path.join('case_data', `milling-archive-${new Date().toISOString().replace(/[:.]/g, '-')}`)

const MILLING_TO_APPROVED = ['ready_for_milling', 'milling_in_progress', 'milling_qc', 'packaging'] as const
const MILLING_TO_DELIVERED = ['dispatched'] as const
const ALL_MILLING_STATUSES = [...MILLING_TO_APPROVED, ...MILLING_TO_DELIVERED]

function heading(title: string) {
  console.log(`\n=== ${title} (${apply ? 'APPLY' : 'DRY RUN'}) ===\n`)
}

async function num(q: Promise<{ n: number }[]>) {
  return Number((await q)[0]?.n ?? 0)
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

async function main() {
  // ── Audit ────────────────────────────────────────────────────────────────
  heading('Audit')

  const millingProfiles = await db
    .select({ id: profiles.id, email: profiles.email, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userType, 'milling_portal'))
  const millingProfileIds = millingProfiles.map((p) => p.id)

  const nonDesignCases = await db
    .select({ id: cases.id, caseNumber: cases.caseNumber, status: cases.status, serviceType: cases.serviceType })
    .from(cases)
    .where(or(ne(cases.serviceType, 'design_only'), eq(cases.designSource, 'partner'), inArray(cases.status, ALL_MILLING_STATUSES)))

  const byCombo = new Map<string, number>()
  for (const c of nonDesignCases) byCombo.set(`${c.serviceType} / ${c.status}`, (byCombo.get(`${c.serviceType} / ${c.status}`) ?? 0) + 1)

  const nonDesignCatalog = await num(db.select({ n: count() }).from(serviceCatalog).where(ne(serviceCatalog.serviceType, 'design_only')))
  const nonDesignPrices = await num(
    db
      .select({ n: count() })
      .from(clientPriceList)
      .innerJoin(serviceCatalog, eq(serviceCatalog.id, clientPriceList.catalogItemId))
      .where(ne(serviceCatalog.serviceType, 'design_only'))
  )
  const clientsToReset = await num(
    db
      .select({ n: count() })
      .from(profiles)
      .where(and(eq(profiles.userType, 'lab_portal'), sql`${profiles.enabledServiceTypes} <> ARRAY['design_only']::text[]`))
  )
  const millingNotifications = await num(db.select({ n: count() }).from(notifications).where(like(notifications.link, '/milling/%')))
  const centers = await db.select().from(millingCenters)
  const assignments = await db.select().from(millingCaseAssignments)
  const history = await db.select().from(caseCenterAssignmentHistory)
  const routing = await db.select().from(millingRoutingRules)
  const millingCatalog = await db.select().from(millingServiceCatalog)
  const contractKeys = centers.map((c) => c.contractDocKey).filter((k): k is string => !!k)

  // Content authored by milling users that would otherwise block profile deletion.
  let authored = { files: 0, previews: 0, refs: 0, holds: 0, caseMsgs: 0, chatMsgs: 0, logs: 0 }
  if (millingProfileIds.length > 0) {
    authored = {
      files: await num(db.select({ n: count() }).from(caseFiles).where(inArray(caseFiles.uploadedBy, millingProfileIds))),
      previews: await num(db.select({ n: count() }).from(casePreviewFiles).where(inArray(casePreviewFiles.uploadedBy, millingProfileIds))),
      refs: await num(db.select({ n: count() }).from(caseReferenceFiles).where(inArray(caseReferenceFiles.uploadedBy, millingProfileIds))),
      holds: await num(db.select({ n: count() }).from(caseHoldFiles).where(inArray(caseHoldFiles.uploadedBy, millingProfileIds))),
      caseMsgs: await num(db.select({ n: count() }).from(caseMessages).where(inArray(caseMessages.senderId, millingProfileIds))),
      chatMsgs: await num(db.select({ n: count() }).from(chatMessages).where(inArray(chatMessages.senderId, millingProfileIds))),
      logs: await num(db.select({ n: count() }).from(activityLogs).where(inArray(activityLogs.userId, millingProfileIds))),
    }
  }

  console.log(`Cases to convert:                 ${nonDesignCases.length}`)
  for (const [k, v] of [...byCombo].sort()) console.log(`    ${k}: ${v}`)
  console.log(`Non-design service_catalog rows:  ${nonDesignCatalog} (+ ${nonDesignPrices} client_price_list rows via cascade)`)
  console.log(`Clients with other flows enabled: ${clientsToReset}`)
  console.log(`/milling notifications:           ${millingNotifications}`)
  console.log(`Milling centres:                  ${centers.length} (${contractKeys.length} contract doc(s) in R2)`)
  console.log(`  assignments / history / routing / catalog: ${assignments.length} / ${history.length} / ${routing.length} / ${millingCatalog.length}`)
  console.log(`Milling portal users:             ${millingProfiles.length}`)
  console.log(`  authored content to re-point:   files ${authored.files}, previews ${authored.previews}, refs ${authored.refs}, holds ${authored.holds}, case msgs ${authored.caseMsgs}, chat msgs ${authored.chatMsgs}`)
  console.log(`  activity_logs to delete:        ${authored.logs}`)

  if (!apply) {
    console.log('\nDry run — no changes written. Re-run with --apply --admin <adminProfileId>.')
    process.exit(0)
  }

  // ── Preconditions for --apply ────────────────────────────────────────────
  if (!adminId) {
    console.error('\n--apply requires --admin <adminProfileId> (actor for audit logs + target for re-pointed content).')
    process.exit(1)
  }
  const [admin] = await db.select().from(profiles).where(eq(profiles.id, adminId)).limit(1)
  if (!admin || admin.role !== 'admin') {
    console.error(`\n--admin ${adminId} is not an existing profile with role 'admin'.`)
    process.exit(1)
  }

  // ── Export (before any destructive write) ────────────────────────────────
  heading('Export')
  fs.mkdirSync(exportDir, { recursive: true })
  const exports: [string, Record<string, unknown>[]][] = [
    ['milling_centers', centers],
    ['milling_service_catalog', millingCatalog],
    ['milling_routing_rules', routing],
    ['milling_case_assignments', assignments],
    ['case_center_assignment_history', history],
    ['milling_portal_profiles', millingProfiles],
    ['converted_cases', nonDesignCases],
  ]
  for (const [name, rows] of exports) {
    fs.writeFileSync(path.join(exportDir, `${name}.csv`), toCsv(rows))
    console.log(`  ${name}.csv — ${rows.length} row(s)`)
  }
  console.log(`Archive written to ${exportDir}`)

  // ── DB changes: one transaction ──────────────────────────────────────────
  heading('Convert')
  await db.transaction(async (tx) => {
    // 1. Cases
    if (nonDesignCases.length > 0) {
      const ids = nonDesignCases.map((c) => c.id)
      await tx.update(cases).set({ status: 'approved' }).where(and(inArray(cases.id, ids), inArray(cases.status, [...MILLING_TO_APPROVED])))
      await tx.update(cases).set({ status: 'delivered' }).where(and(inArray(cases.id, ids), inArray(cases.status, [...MILLING_TO_DELIVERED])))
      await tx.update(cases).set({ serviceType: 'design_only', designSource: 'internal' }).where(inArray(cases.id, ids))
      for (let i = 0; i < nonDesignCases.length; i += 500) {
        await tx.insert(activityLogs).values(
          nonDesignCases.slice(i, i + 500).map((c) => ({
            caseId: c.id,
            userId: admin.id,
            userType: admin.userType,
            userRole: admin.role,
            action: 'case.converted_to_design_only',
            details: { previousServiceType: c.serviceType, previousStatus: c.status },
          }))
        )
      }
      console.log(`Cases converted: ${nonDesignCases.length}`)
    }

    // 2. Pricing (client_price_list cascades on catalog_item_id)
    await tx.delete(serviceCatalog).where(ne(serviceCatalog.serviceType, 'design_only'))
    console.log(`service_catalog rows deleted: ${nonDesignCatalog}`)

    // 3. Clients
    await tx
      .update(profiles)
      .set({ enabledServiceTypes: ['design_only'] })
      .where(and(eq(profiles.userType, 'lab_portal'), sql`${profiles.enabledServiceTypes} <> ARRAY['design_only']::text[]`))
    console.log(`Client profiles reset: ${clientsToReset}`)

    // 4. Notifications
    await tx.delete(notifications).where(like(notifications.link, '/milling/%'))
    console.log(`Notifications deleted: ${millingNotifications}`)

    // 5. Milling data — children before parents
    await tx.delete(caseCenterAssignmentHistory)
    await tx.delete(millingCaseAssignments)
    await tx.delete(millingRoutingRules)
    await tx.delete(millingServiceCatalog)

    if (millingProfileIds.length > 0) {
      await tx.update(caseFiles).set({ uploadedBy: admin.id }).where(inArray(caseFiles.uploadedBy, millingProfileIds))
      await tx.update(casePreviewFiles).set({ uploadedBy: admin.id }).where(inArray(casePreviewFiles.uploadedBy, millingProfileIds))
      await tx.update(caseReferenceFiles).set({ uploadedBy: admin.id }).where(inArray(caseReferenceFiles.uploadedBy, millingProfileIds))
      await tx.update(caseHoldFiles).set({ uploadedBy: admin.id }).where(inArray(caseHoldFiles.uploadedBy, millingProfileIds))
      await tx.update(caseMessages).set({ senderId: admin.id }).where(inArray(caseMessages.senderId, millingProfileIds))
      await tx.update(chatMessages).set({ senderId: admin.id }).where(inArray(chatMessages.senderId, millingProfileIds))
      await tx.delete(activityLogs).where(inArray(activityLogs.userId, millingProfileIds))
      await tx.delete(profiles).where(inArray(profiles.id, millingProfileIds))
    }
    await tx.delete(millingCenters)
    console.log(`Milling centres deleted: ${centers.length}; milling users deleted: ${millingProfiles.length}`)
  })

  // ── After commit: external systems ───────────────────────────────────────
  heading('External cleanup')
  if (contractKeys.length > 0) {
    const { deleteKeys } = await import('../src/lib/r2-objects')
    const deleted = await deleteKeys(contractKeys)
    console.log(`R2 contract docs deleted: ${deleted}/${contractKeys.length}`)
  }
  if (millingProfileIds.length > 0) {
    const { supabaseAdmin } = await import('../src/lib/supabase/admin')
    let failed = 0
    for (const id of millingProfileIds) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
      if (error && !/not.*found/i.test(error.message)) {
        failed++
        console.error(`  Supabase auth delete failed for ${id}: ${error.message}`)
      }
    }
    console.log(`Supabase auth users deleted: ${millingProfileIds.length - failed}/${millingProfileIds.length}`)
  }

  console.log('\nDone.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
