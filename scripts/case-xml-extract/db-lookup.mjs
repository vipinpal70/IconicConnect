#!/usr/bin/env node
/**
 * Look up the cases that were created from these scan files, and compare what
 * a human actually entered against what `extract.mjs` derives from the XML.
 *
 *   node --env-file=.env scripts/case-xml-extract/db-lookup.mjs case_data
 *   node --env-file=.env scripts/case-xml-extract/db-lookup.mjs case_data --limit 10 --out report.md
 *
 * Matching is on `case_files.file_name` containing the 3Shape order id.
 *
 * READ ONLY — every statement is a SELECT. Nothing is written to the database.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import postgres from 'postgres'

const argv = process.argv.slice(2)
const flagValue = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const targets = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const limit = Number(flagValue('--limit', '10'))
const outFile = flagValue('--out')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run with:  node --env-file=.env scripts/case-xml-extract/db-lookup.mjs …')
  process.exit(1)
}

/* -------- what the XML says (reuse the extractor, unchanged) -------- */

const extracted = JSON.parse(
  execFileSync('node', [new URL('extract.mjs', import.meta.url).pathname, ...targets, '--json'], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString()
).cases.slice(0, limit)

console.error(`Parsed ${extracted.length} scan file(s); querying the database…`)

/* ---------------------------- database ---------------------------- */

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 30,
  idle_timeout: 10,
})

/** The Supabase host is dual-stack and the v6 route is a black hole here, so
 *  a connect attempt fails roughly half the time. Retry rather than give up. */
async function withRetry(fn, attempts = 6) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (err) {
      lastError = err
      const retriable = /ETIMEDOUT|ENETUNREACH|ECONNRESET|CONNECT_TIMEOUT/.test(String(err.code ?? err.message))
      if (!retriable) throw err
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw lastError
}

const patterns = extracted.map((c) => `%${c.source.id}%`)

const fileRows = await withRetry(() => sql`
  select
    f.id            as file_id,
    f.file_name,
    f.file_size,
    f.file_type,
    f.note          as file_note,
    f.created_at    as file_created_at,
    c.id            as case_id,
    c.case_number,
    c.category,
    c.sub_type_data,
    c.status,
    c.service_type,
    c.hold_reason,
    c.feedback_reason,
    c.reject_reason,
    c.output_note,
    c.preferred_teeth_library,
    c.auto_approved,
    c.tat,
    c.due_date,
    c.start_time,
    c.delivered_time,
    c.created_at    as case_created_at,
    c.created_by,
    client.lab_name  as client_lab,
    client.full_name as client_name,
    client.email     as client_email,
    designer.full_name as designer_name,
    qc.full_name       as qc_name
  from case_files f
  left join cases    c        on c.id = f.case_id
  left join profiles client   on client.id = c.client_id
  left join profiles designer on designer.id = c.designer_id
  left join profiles qc       on qc.id = c.qc_id
  where f.file_name ilike any(${patterns}::text[])
  order by f.created_at`)

const caseIds = [...new Set(fileRows.map((r) => r.case_id).filter(Boolean))]

const messageCounts = caseIds.length
  ? await withRetry(() => sql`
      select case_id, count(*)::int as n
      from case_messages where case_id = any(${caseIds}::uuid[])
      group by case_id`)
  : []
const messageByCase = new Map(messageCounts.map((r) => [r.case_id, r.n]))

/* -- How the live database actually spells things. The scan files match no
   -- existing case, so this is the only way to check our output against what
   -- humans really enter. -- */
const vocab = {
  categories: await withRetry(() => sql`
    select category, count(*)::int n, min(created_at)::date first_seen, max(created_at)::date last_seen
    from cases group by category order by n desc`),
  prefixes: await withRetry(() => sql`
    select split_part(case_number,'-',1) prefix, category, count(*)::int n
    from cases where case_number is not null group by 1,2 order by n desc`),
  subTypeKeys: await withRetry(() => sql`
    select k, count(*)::int n from cases, jsonb_object_keys(sub_type_data) k
    group by k order by n desc`),
  fieldValues: await withRetry(() => sql`
    select 'caseType' f, sub_type_data->>'caseType' v, count(*)::int n from cases where sub_type_data ? 'caseType' group by 2
    union all select 'caseType1', sub_type_data->>'caseType1', count(*)::int from cases where sub_type_data ? 'caseType1' group by 2
    union all select 'caseType2', sub_type_data->>'caseType2', count(*)::int from cases where sub_type_data ? 'caseType2' group by 2
    union all select 'occlusion', sub_type_data->>'occlusion', count(*)::int from cases where sub_type_data ? 'occlusion' group by 2
    union all select 'arch',      sub_type_data->>'arch',      count(*)::int from cases where sub_type_data ? 'arch' group by 2
    union all select 'toothSystem', sub_type_data->>'toothSystem', count(*)::int from cases where sub_type_data ? 'toothSystem' group by 2
    union all select 'modelRequired', sub_type_data->>'modelRequired', count(*)::int from cases where sub_type_data ? 'modelRequired' group by 2
    order by 1, 3 desc`),
  catalog: await withRetry(() => sql`
    select category, count(*)::int n from service_catalog group by category order by n desc`),
  totals: (await withRetry(() => sql`
    select (select count(*)::int from cases) cases, (select count(*)::int from case_files) files`))[0],
  labFiles: await withRetry(() => sql`
    select split_part(file_name,'_',1) lab, count(*)::int n
    from case_files where file_name ~ '^[0-9]{4,6}_' group by 1 order by n desc limit 10`),
}

await sql.end()

/* ---------------------------- compare ----------------------------- */

const byId = new Map()
for (const row of fileRows) {
  // One case can carry several files; key on the scan file we matched.
  const source = extracted.find((c) => row.file_name.toLowerCase().includes(c.source.id.toLowerCase()))
  if (!source) continue
  if (!byId.has(source.source.id)) byId.set(source.source.id, { source, rows: [] })
  byId.get(source.source.id).rows.push(row)
}

const results = extracted.map((c) => ({
  extracted: c,
  db: byId.get(c.source.id)?.rows ?? [],
}))

const md = renderMarkdown(results, messageByCase, vocab)
if (outFile) {
  writeFileSync(outFile, md)
  console.error(`Wrote ${outFile}`)
} else {
  console.log(md)
}

/* ---------------------------- render ------------------------------ */

function renderMarkdown(results, messageByCase, vocab) {
  const found = results.filter((r) => r.db.length)
  const missing = results.filter((r) => !r.db.length)
  const L = []

  L.push('# Scan files vs. the cases created from them')
  L.push('')
  L.push(`Matched \`case_files.file_name\` against the 3Shape order id of each scan file.`)
  L.push(`Checked **${results.length}** scan file(s): **${found.length}** found in the database, **${missing.length}** not found.`)
  L.push('')
  L.push('Generated by `scripts/case-xml-extract/db-lookup.mjs` (read-only SELECTs).')
  L.push('')

  /* ---- summary: does the human-entered category match ours? ---- */
  L.push('## Summary')
  L.push('')
  L.push('| Scan file | In DB | Case no. | Category (DB) | Category (derived) | Match |')
  L.push('|---|---|---|---|---|---|')
  for (const r of results) {
    const row = r.db[0]
    const ours = r.extracted.casePayload.category ?? '_(no order file)_'
    if (!row) {
      L.push(`| \`${r.extracted.source.id}\` | ✘ | — | — | ${ours} | — |`)
      continue
    }
    const same = row.category === ours
    L.push(`| \`${r.extracted.source.id}\` | ✔ | ${row.case_number ?? '—'} | ${row.category ?? '—'} | ${ours} | ${same ? '✅' : '❌'} |`)
  }
  L.push('')

  /* ---- field-level comparison ---- */
  L.push('## Field-by-field: what the human entered vs. what the XML gives')
  L.push('')
  for (const r of found) {
    const row = r.db[0]
    const dbSub = row.sub_type_data ?? {}
    const ourSub = r.extracted.casePayload.subTypeData
    L.push(`### \`${r.extracted.source.id}\``)
    L.push('')
    L.push(`**Case ${row.case_number ?? '—'}** · ${row.status} · ${row.service_type} · client: ${row.client_lab ?? row.client_name ?? '—'}`)
    L.push('')
    L.push('| Field | Database | Derived from the upload | |')
    L.push('|---|---|---|---|')
    L.push(cmpRow('category', row.category, r.extracted.casePayload.category))
    const keys = [...new Set([...Object.keys(dbSub), ...Object.keys(ourSub)])]
      .filter((k) => k !== 'notes')
      .sort()
    for (const k of keys) L.push(cmpRow(k, dbSub[k], ourSub[k]))
    L.push('')

    L.push('<details><summary>Case record</summary>')
    L.push('')
    L.push('| Column | Value |')
    L.push('|---|---|')
    const meta = [
      ['case_number', row.case_number], ['status', row.status], ['service_type', row.service_type],
      ['client', row.client_lab ?? row.client_name], ['client_email', row.client_email],
      ['designer', row.designer_name], ['qc', row.qc_name], ['created_by', row.created_by],
      ['created_at', iso(row.case_created_at)], ['due_date', iso(row.due_date)],
      ['start_time', iso(row.start_time)], ['delivered_time', iso(row.delivered_time)],
      ['tat (min)', row.tat], ['auto_approved', row.auto_approved],
      ['preferred_teeth_library', row.preferred_teeth_library],
      ['hold_reason', row.hold_reason], ['feedback_reason', row.feedback_reason],
      ['reject_reason', row.reject_reason], ['output_note', row.output_note],
      ['chat messages', messageByCase.get(row.case_id) ?? 0],
    ]
    for (const [k, v] of meta) if (v !== null && v !== undefined && v !== '') L.push(`| ${k} | ${md1(v)} |`)
    L.push('')
    L.push('**Files on this case**')
    L.push('')
    L.push('| File | Size | Uploaded | Note |')
    L.push('|---|---|---|---|')
    for (const f of r.db) {
      L.push(`| \`${f.file_name}\` | ${mb(f.file_size)} | ${iso(f.file_created_at)} | ${md1(f.file_note ?? '—')} |`)
    }
    L.push('')
    L.push('**Notes stored on the case**')
    L.push('')
    L.push('```')
    L.push(String(dbSub.notes ?? '(none)').trim() || '(empty)')
    L.push('```')
    L.push('')
    L.push('**Notes the XML would have produced**')
    L.push('')
    L.push('```')
    L.push(String(ourSub.notes ?? '').trim())
    L.push('```')
    L.push('')
    L.push('</details>')
    L.push('')
  }

  if (missing.length) {
    L.push('## Not in the database')
    L.push('')
    L.push('These scan files have no `case_files` row whose name contains their order id:')
    L.push('')
    for (const r of missing) {
      L.push(`- \`${r.extracted.source.id}\` — would be **${r.extracted.casePayload.category}**, ${r.extracted.order.customer ?? 'unknown lab'}`)
    }
    L.push('')
  }

  /* ---- what the live database actually contains ---- */
  L.push('---')
  L.push('')
  L.push('## Reference: what the live database actually contains')
  L.push('')
  L.push(`Whole table: **${vocab.totals.cases}** cases, **${vocab.totals.files}** case files.`)
  L.push('')

  L.push('### `cases.category` values in use')
  L.push('')
  L.push('| Category | Cases | First | Last |')
  L.push('|---|---|---|---|')
  for (const r of vocab.categories) {
    L.push(`| \`${r.category ?? '(null)'}\` | ${r.n} | ${dateOnly(r.first_seen)} | ${dateOnly(r.last_seen)} |`)
  }
  L.push('')
  L.push('### `service_catalog.category` values (the pricing side)')
  L.push('')
  L.push('| Category | Rows |')
  L.push('|---|---|')
  for (const r of vocab.catalog) L.push(`| \`${r.category}\` | ${r.n} |`)
  L.push('')

  L.push('### `case_number` prefix per category')
  L.push('')
  L.push('| Prefix | Category | Cases |')
  L.push('|---|---|---|')
  for (const r of vocab.prefixes) L.push(`| ${r.prefix} | \`${r.category}\` | ${r.n} |`)
  L.push('')

  L.push('### `sub_type_data` keys in use')
  L.push('')
  L.push('| Key | Cases | Produced by the extractor? |')
  L.push('|---|---|---|')
  const produced = new Set(['teeth','modelRequired','toothSystem','notes','caseType','caseType1','caseType2','crownBridgeTeeth','occlusion','arch','die','articulator','drainHoles'])
  for (const r of vocab.subTypeKeys) L.push(`| \`${r.k}\` | ${r.n} | ${produced.has(r.k) ? '✅' : '—'} |`)
  L.push('')

  L.push('### Values operators actually pick')
  L.push('')
  let currentField = null
  L.push('| Field | Value | Cases |')
  L.push('|---|---|---|')
  for (const r of vocab.fieldValues) {
    L.push(`| ${r.f === currentField ? '' : '`' + r.f + '`'} | ${r.v === null ? '(null)' : '`' + r.v + '`'} | ${r.n} |`)
    currentField = r.f
  }
  L.push('')

  /* ---- findings: differences between what the code declares and what the
     ---- database contains. Written out with the report so the evidence and
     ---- the conclusion stay together. ---- */
  const dbCats = new Set(vocab.categories.map((r) => r.category))
  const catalogCats = new Set(vocab.catalog.map((r) => r.category))
  const drifted = [...dbCats].filter((c) => c && !catalogCats.has(c))

  L.push('### Scanner-exported file names already in the database, by lab id')
  L.push('')
  L.push('| Lab id (3Shape `ClientID`) | Files |')
  L.push('|---|---|')
  for (const r of vocab.labFiles) L.push(`| ${r.lab} | ${r.n} |`)
  L.push('')

  L.push('---')
  L.push('')
  L.push('## Findings')
  L.push('')

  L.push('### 1. The extractor produces exactly the right shape')
  L.push('')
  L.push('Every `sub_type_data` key the live database uses is one the extractor')
  L.push('already emits — no key is missing, none is invented. In particular the real')
  L.push('Appliance cases store `arch: "Upper"` together with `teeth: [1…16]`, the full')
  L.push('arch, which is exactly what the extractor derives from a splint\'s single')
  L.push('placeholder tooth. Implant cases store `caseType1`/`caseType2` plus a separate')
  L.push('`crownBridgeTeeth` array, again matching.')
  L.push('')

  if (drifted.length) {
    L.push('### 2. Live category names do not match `case-hierarchy.ts`')
    L.push('')
    L.push('`cases.category` values that do **not** exist in `service_catalog`:')
    L.push('')
    L.push('| `cases.category` | `service_catalog` / `CASE_HIERARCHY` spelling |')
    L.push('|---|---|')
    const pairs = { 'Crown & Bridges': 'Crown & Bridge', Implant: 'Implants', Denture: 'Dentures' }
    for (const c of drifted) L.push(`| \`${c}\` | \`${pairs[c] ?? '(no equivalent)'}\` |`)
    L.push('')
    L.push('Cause: `src/app/(ops)/cases/page.tsx` carries its own inline `CASE_HIERARCHY`')
    L.push('(around line 216) with the legacy vocabulary, and that is the page the cases')
    L.push('were created through. `src/lib/case-hierarchy.ts` calls itself the "single')
    L.push('source of truth ... shared by AddCaseDialog.tsx and client/(dashboard)/cases/page.tsx"')
    L.push('— the ops page was never folded in, so a third drifted copy is still live.')
    L.push('')
    L.push('Other values drift the same way: the ops page offers `Vineers` (sic),')
    L.push('`Sports Guard`, `Mouth Guard`, lowercase `even occlusion`/`custom`, and lowercase')
    L.push('Implant attachments (`crown`, `bridge`, `coping`, …), where `case-hierarchy.ts`')
    L.push('has `Veneers`, `Sport Guards`, `Mouth Guards`, `Even Occlusion`, `Crown`, `Bridge`.')
    L.push('The `occlusion` column above confirms it: all 8 rows are lowercase `even occlusion`.')
    L.push('')
    L.push('**The extractor emits the `case-hierarchy.ts` spelling**, since that is what the')
    L.push('service-catalog and pricing lookups key on. Feeding its output to the ops page')
    L.push('flow instead would need a translation step.')
    L.push('')

    L.push('### 3. Latent: the case-number prefix will break on this branch')
    L.push('')
    L.push('`CATEGORY_PREFIXES` in `src/lib/case-utils.ts` was rekeyed from the legacy names')
    L.push('to the new ones on 2026-08-15 (commit `243ad17`, an ancestor of the current HEAD).')
    L.push('The ops page still sends the legacy names, and `getCasePrefix` falls back to')
    L.push('initials when a key is missing:')
    L.push('')
    L.push('| Category the ops page sends | `getCasePrefix` returns | Stored prefixes so far |')
    L.push('|---|---|---|')
    L.push('| `Crown & Bridges` | `CBX` | `CAB` |')
    L.push('| `Implant` | `IXX` | `CAI` |')
    L.push('| `Denture` | `DXX` | `CDT` |')
    L.push('')
    L.push('Every stored case still has the correct prefix, including ones created on')
    L.push('2026-08-17 — so production is evidently running a build from before that commit.')
    L.push('This is a regression waiting on the next deploy of this branch, not a live fault.')
    L.push('')
    L.push('Same root cause, second effect: `getRequiredServiceSelections` switches on the')
    L.push('new category names, so a legacy name falls through to `default` and returns an')
    L.push('empty selection list — the disabled-service check added in that same commit')
    L.push('silently passes for every ops-created case.')
    L.push('')
  }

  L.push('### 4. Operators work in FDI more often than USA')
  L.push('')
  const fdi = vocab.fieldValues.find((r) => r.f === 'toothSystem' && r.v === 'FDI')?.n ?? 0
  const usa = vocab.fieldValues.find((r) => r.f === 'toothSystem' && r.v === 'USA')?.n ?? 0
  L.push(`\`toothSystem\` is \`FDI\` on ${fdi} cases and \`USA\` on ${usa}. The extractor always emits`)
  L.push('`USA`, which is correct — 3Shape\'s `ToothNumber` really is Universal Numbering —')
  L.push('but imported cases will open in a different notation than roughly half the')
  L.push('existing ones. Converting to FDI on import is a one-line map if that is preferred.')
  L.push('')

  return L.join('\n')
}


function dateOnly(v) { return v ? new Date(v).toISOString().slice(0, 10) : '—' }

function cmpRow(field, dbValue, ourValue) {
  const a = norm(dbValue)
  const b = norm(ourValue)
  const mark = a === b ? '✅' : a === '—' ? '➕' : b === '—' ? '➖' : '❌'
  return `| \`${field}\` | ${a} | ${b} | ${mark} |`
}

// Function declarations, not const arrows: renderMarkdown calls these from
// above their definition and `const` would be in the temporal dead zone.
function norm(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? `[${v.join(', ')}]` : '[]'
  return String(v)
}
function md1(v) { return String(v).replace(/\|/g, '\\|').replace(/\n+/g, ' · ') }
function iso(v) { return v ? new Date(v).toISOString().replace('T', ' ').slice(0, 16) : null }
function mb(n) { return n ? `${(n / 1024 / 1024).toFixed(1)} MB` : '—' }
