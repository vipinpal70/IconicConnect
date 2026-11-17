import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../src/db'

/**
 * READ-ONLY audit: find design outputs/previews stored at the same R2 key as a lab's scan.
 *
 * Until outputs moved to case-scoped keys (src/lib/case-file-keys.ts), an output named exactly like the
 * scan it was designed from — same name AND extension — was written to the scan's key `<lab>/<name>`,
 * replacing the lab's original scan. Same for a file reused across two cases of the same lab.
 *
 * For every hit, the object at that key now holds whichever file was written LAST (compare the
 * timestamps): if the output came after the scan, the lab's original scan is gone from R2 and can only
 * be recovered from a backup taken before `output_created_at`.
 *
 * Usage:  npx tsx scripts/audit-output-scan-collisions.ts            (summary + table)
 *         npx tsx scripts/audit-output-scan-collisions.ts --csv      (CSV on stdout, for a spreadsheet)
 *
 * Writes nothing.
 */

type Row = {
  r2_key: string
  scan_case_id: string
  scan_case_number: string | null
  scan_created_at: Date
  other_kind: string
  other_case_id: string | null
  other_case_number: string | null
  other_created_at: Date
  scan_overwritten: boolean
}

async function main() {
  const csv = process.argv.includes('--csv')

  const result = await db.execute(sql`
    SELECT s.r2_key,
           s.case_id                      AS scan_case_id,
           sc.case_number                 AS scan_case_number,
           s.created_at                   AS scan_created_at,
           o.kind::text                   AS other_kind,
           o.case_id                      AS other_case_id,
           oc.case_number                 AS other_case_number,
           o.created_at                   AS other_created_at,
           (o.created_at > s.created_at)  AS scan_overwritten
    FROM files s
    JOIN files o
      ON o.r2_key = s.r2_key
     AND o.id <> s.id
     AND o.deleted_at IS NULL
     AND (o.kind IN ('output', 'preview') OR (o.kind = 'scan' AND o.case_id IS DISTINCT FROM s.case_id))
    LEFT JOIN cases sc ON sc.id = s.case_id
    LEFT JOIN cases oc ON oc.id = o.case_id
    WHERE s.kind = 'scan'
      AND s.deleted_at IS NULL
      AND s.r2_key NOT LIKE 'http%'
    ORDER BY scan_overwritten DESC, o.created_at DESC
  `)
  const rows = (Array.isArray(result) ? result : (result as { rows: Row[] }).rows) as Row[]

  if (csv) {
    console.log('r2_key,scan_case_number,scan_case_id,scan_created_at,other_kind,other_case_number,other_case_id,other_created_at,scan_overwritten')
    for (const r of rows) {
      console.log([
        r.r2_key, r.scan_case_number ?? '', r.scan_case_id, new Date(r.scan_created_at).toISOString(),
        r.other_kind, r.other_case_number ?? '', r.other_case_id ?? '', new Date(r.other_created_at).toISOString(),
        r.scan_overwritten,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    }
    process.exit(0)
  }

  const overwritten = rows.filter((r) => r.scan_overwritten)
  const sameCase = rows.filter((r) => r.other_case_id === r.scan_case_id)
  console.log('\n=== Audit: outputs / previews sharing an R2 key with a lab scan (read-only) ===\n')
  console.log(`Shared keys found:                         ${rows.length}`)
  console.log(`  …where the scan was likely overwritten:  ${overwritten.length}`)
  console.log(`  …within the same case:                   ${sameCase.length}`)
  console.log(`  …across different cases:                ${rows.length - sameCase.length}\n`)

  if (rows.length > 0) {
    console.table(rows.slice(0, 200).map((r) => ({
      key: r.r2_key,
      scanCase: r.scan_case_number ?? r.scan_case_id,
      other: `${r.other_kind} ${r.other_case_number ?? r.other_case_id ?? ''}`.trim(),
      scanAt: new Date(r.scan_created_at).toISOString().slice(0, 16),
      otherAt: new Date(r.other_created_at).toISOString().slice(0, 16),
      scanOverwritten: r.scan_overwritten,
    })))
    if (rows.length > 200) console.log(`…and ${rows.length - 200} more (use --csv for the full list).`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Audit failed:', err)
  process.exit(1)
})
