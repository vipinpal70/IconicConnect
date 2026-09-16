#!/usr/bin/env node
/**
 * Read 3Shape dental-scan exports and report everything needed to create an
 * IconicConnect case.
 *
 *   node scripts/case-xml-extract/extract.mjs case_data
 *   node scripts/case-xml-extract/extract.mjs case_data/Cases/Burbank/2238152.zip --json
 *   node scripts/case-xml-extract/extract.mjs case_data --json --out out.json
 *
 * Accepts a loose order .xml, an extracted case folder, a .zip case, or any
 * directory containing those (searched recursively).
 *
 * Flags
 *   --json                 emit machine-readable JSON instead of the report
 *   --out <file>           write output to a file
 *   --client-id <uuid>     stamp every case payload with this client UUID
 *   --service-type <t>     design_only | design_milling | milling_only
 *   --include-patient      keep the patient name in notes (off by default:
 *                          cases deliberately do not store patient names)
 *   --model-required <y/n> "yes" or "no"; defaults to "no" and is flagged
 *   --quiet                report only, no per-unit detail
 *
 * Reads only. Never writes into the project and never touches the database.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, basename, extname, resolve } from 'node:path'
import { parseOrder, parseScanSettings } from './lib/dental-order.mjs'
import { mapOrderToCase } from './lib/map-to-case.mjs'
import { describeRawScan, rawScanToCase } from './lib/raw-scan.mjs'
import { openZip } from './lib/zip.mjs'

/* ---------------------------- args ---------------------------- */

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const targets = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))

if (!targets.length) {
  console.error(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^\/\*\*?|^ \* ?/gm, ''))
  process.exit(1)
}

const options = {
  clientId: value('--client-id'),
  serviceType: value('--service-type'),
  includePatientName: flag('--include-patient'),
  modelRequired: value('--model-required'),
}

/* --------------------------- sources -------------------------- */

/**
 * A "source" is one case: its order XML plus whatever companion files we
 * found next to it.
 * @returns {{ id: string, path: string, kind: string,
 *             orderXml: string, materialsXml: string|null,
 *             sidXml: string|null, files: string[] }[]}
 */
function collectSources(target) {
  const path = resolve(target)
  const st = statSync(path)

  if (st.isFile()) {
    if (extname(path).toLowerCase() === '.zip') return [fromZip(path)].filter(Boolean)
    if (extname(path).toLowerCase() === '.xml') return [fromLooseXml(path)].filter(Boolean)
    return []
  }

  // A case folder: `<name>/<name>.xml` alongside Materials.xml.
  const direct = fromCaseFolder(path)
  if (direct) return [direct]

  const out = []
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    out.push(...collectSources(join(path, entry)))
  }
  if (out.length) return out

  // Last resort only: a folder of loose scan meshes with no order file
  // anywhere beneath it. Checked after recursion so a drop-folder of many
  // cases is never swallowed as one bundle just because a .dcm lives deep
  // inside it.
  const raw = rawFromFolder(path)
  return raw ? [raw] : []
}

const readText = (p) => readFileSync(p, 'utf8')

function fromLooseXml(path) {
  const text = readText(path)
  if (!/<DentalContainer/i.test(text) || !/TDM_Item_Order/.test(text)) return null
  const dir = path.slice(0, path.lastIndexOf('/'))
  const sibling = (name) => {
    try { return readText(join(dir, name)) } catch { return null }
  }
  return {
    id: basename(path, extname(path)),
    path,
    kind: 'xml',
    orderXml: text,
    materialsXml: sibling('Materials.xml'),
    sidXml: sibling('SID_UserInputData.XML') ?? sibling('SID_UserInputData.xml'),
    files: [basename(path)],
  }
}

/**
 * A 3Shape case folder is named after its order and holds `<name>.xml`.
 * Anything looser is treated as a plain directory to recurse into, so a
 * drop-folder of many cases doesn't get mistaken for one case.
 */
function fromCaseFolder(dir) {
  let names
  try { names = readdirSync(dir) } catch { return null }
  const name = basename(dir)
  const orderName = names.find((n) => n === `${name}.xml`)
  if (!orderName) return null
  const source = fromLooseXml(join(dir, orderName))
  if (!source) return null
  source.kind = 'folder'
  source.id = name
  source.path = dir
  source.files = listFiles(dir).map((f) => f.slice(dir.length + 1))
  return source
}

function fromZip(path) {
  let zip
  try { zip = openZip(path) } catch (err) {
    console.error(`! ${basename(path)}: ${err.message}`)
    return null
  }
  const xmls = zip.entries.filter((e) =>
    e.name.toLowerCase().endsWith('.xml') && !e.name.endsWith('/') && !e.encrypted)
  const orderEntry = xmls.find((e) => {
    const base = basename(e.name)
    return base !== 'Materials.xml' && base.toLowerCase() !== 'sid_userinputdata.xml' && e.size < 5_000_000
  })
  const orderXml = orderEntry
    ? zip.read((e) => e.name === orderEntry.name)?.toString('utf8')
    : null
  if (!orderXml || !/TDM_Item_Order/.test(orderXml)) {
    // No DentalContainer inside: treat it as a plain scan upload instead of
    // discarding it (see lib/raw-scan.mjs).
    return rawFromZip(zip, path)
  }
  const grab = (base) => {
    const buf = zip.read((e) => basename(e.name).toLowerCase() === base)
    return buf ? buf.toString('utf8') : null
  }
  return {
    id: basename(orderEntry.name, '.xml'),
    path,
    kind: 'zip',
    orderXml,
    materialsXml: grab('materials.xml'),
    sidXml: grab('sid_userinputdata.xml'),
    files: zip.entries.filter((e) => !e.name.endsWith('/')).map((e) => e.name),
  }
}

/** A .zip with meshes but no order XML. */
function rawFromZip(zip, path) {
  const entries = zip.entries
    .filter((e) => !e.name.endsWith('/'))
    .map((e) => ({
      name: e.name,
      size: e.size,
      mtime: null,
      readHead: () => {
        try { return zip.read((x) => x.name === e.name)?.subarray(0, 84) ?? null } catch { return null }
      },
    }))
  const desc = describeRawScan(entries, basename(path, '.zip'))
  if (!desc.scans.length) return null
  return { id: desc.id, path, kind: 'raw-zip', raw: desc, files: entries.map((e) => e.name) }
}

/** A folder with meshes but no order XML. */
function rawFromFolder(dir) {
  const paths = listFiles(dir)
  const entries = paths.map((p) => {
    let st
    try { st = statSync(p) } catch { st = null }
    return {
      name: p.slice(dir.length + 1),
      size: st?.size ?? 0,
      mtime: st?.mtime ?? null,
      readHead: () => {
        try {
          const fd = openSync(p, 'r'); const buf = Buffer.alloc(84)
          readSync(fd, buf, 0, 84, 0); closeSync(fd); return buf
        } catch { return null }
      },
    }
  })
  const desc = describeRawScan(entries, basename(dir))
  if (!desc.scans.length) return null
  return { id: desc.id, path: dir, kind: 'raw-folder', raw: desc, files: entries.map((e) => e.name) }
}

function listFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) listFiles(p, acc)
    else acc.push(p)
  }
  return acc
}

/* ---------------------------- run ----------------------------- */

// The same case often shows up more than once — as an extracted folder, as
// the .zip it came in, and as a loose copy of its order XML. Keep the richest.
const RICHNESS = { folder: 5, zip: 4, xml: 3, 'raw-folder': 2, 'raw-zip': 1 }
const byId = new Map()
for (const t of targets) {
  for (const s of collectSources(t)) {
    const existing = byId.get(s.id)
    if (!existing || RICHNESS[s.kind] > RICHNESS[existing.kind]) byId.set(s.id, s)
  }
}
const sources = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))

if (!sources.length) {
  console.error('No 3Shape order XML found under: ' + targets.join(', '))
  process.exit(1)
}

const results = sources.map((source) => {
  if (source.raw) {
    return {
      source: {
        id: source.id, path: source.path, kind: source.kind,
        hasMaterialsXml: false, hasScanSettings: false, fileCount: source.files.length,
      },
      raw: source.raw,
      order: null, units: [], scans: [], modelElements: [], connectorGroups: [], scanSettings: null,
      ...rawScanToCase(source.raw, options),
    }
  }
  const parsed = parseOrder(source.orderXml, source.materialsXml)
  const scanSettings = parseScanSettings(source.sidXml)
  const mapped = mapOrderToCase(parsed, scanSettings, options)
  return {
    source: {
      id: source.id,
      path: source.path,
      kind: source.kind,
      hasMaterialsXml: Boolean(source.materialsXml),
      hasScanSettings: Boolean(source.sidXml),
      fileCount: source.files.length,
    },
    order: parsed.order,
    units: parsed.units,
    scans: parsed.scans,
    modelElements: parsed.modelElements,
    connectorGroups: parsed.connectorGroups,
    scanSettings,
    ...mapped,
  }
})

const output = flag('--json')
  ? JSON.stringify({ generatedAt: new Date().toISOString(), count: results.length, cases: results }, null, 2)
  : renderReport(results, { quiet: flag('--quiet'), includePatientName: options.includePatientName })

const outFile = value('--out')
if (outFile) {
  writeFileSync(outFile, output)
  console.log(`Wrote ${results.length} case(s) to ${outFile}`)
} else {
  console.log(output)
}

/* --------------------------- report --------------------------- */

/** A mesh-only upload: report the inventory and be explicit about the gap. */
function renderRaw(L, r, pad) {
  const d = r.raw
  L.push('')
  L.push('NO ORDER FILE IN THIS UPLOAD')
  L.push('  This bundle holds scan meshes only — no 3Shape DentalContainer, so it')
  L.push('  carries no indication, no tooth numbers, no material and no comments.')
  L.push('')
  L.push('WHAT IS IN THE BUNDLE')
  L.push(`  Stage ................ ${d.stages.length ? d.stages.join(', ') : 'not indicated'}`)
  L.push(`  Arches scanned ....... ${d.arches.length ? d.arches.join(' + ') : 'could not tell'}`)
  L.push(`  Bite registration .... ${d.hasBite ? 'yes' : 'no'}`)
  L.push(`  Exported by .......... ${d.creators.length ? d.creators.join(', ') : 'unknown'}`)
  L.push(`  Total size ........... ${(d.totalBytes / 1024 / 1024).toFixed(1)} MB`)
  L.push('')
  L.push('  Scans')
  for (const sc of d.scans) {
    const tris = sc.triangles ? `${sc.triangles.toLocaleString('en-US')} triangles` : ''
    L.push(`    - ${pad(sc.role ?? '(unrecognised)', 26)} ${pad(sc.file, 22)} ${pad((sc.sizeBytes / 1024 / 1024).toFixed(1) + ' MB', 10)} ${tris}`)
  }
  if (d.otherFiles.length) L.push(`  Other files: ${d.otherFiles.join(', ')}`)
  if (d.skipped.length) L.push(`  Ignored: ${d.skipped.join(', ')}`)

  L.push('')
  L.push('CASE PAYLOAD  (POST /api/cases)')
  const p = r.casePayload
  L.push(`  category ............ ${p.category ?? '** REQUIRED — cannot be derived from meshes **'}`)
  L.push(`  serviceType ......... ${p.serviceType}`)
  L.push(`  clientId ............ ${p.clientId ?? '** REQUIRED **'}`)
  for (const [k, v] of Object.entries(p.subTypeData)) {
    if (k === 'notes') continue
    L.push(`  subTypeData.${pad(k, 16)} ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
  }

  L.push('')
  L.push('NEEDS A HUMAN')
  for (const n of r.needsReview) {
    L.push(`  ! ${pad(n.field, 26)} ${Array.isArray(n.value) ? `[${n.value.join(', ')}]` : n.value ?? '(none)'}`)
    L.push(`      ${n.why}`)
  }
}

function pad(s, n) { return String(s).padEnd(n) }
function fmt(v) { return v == null ? 'not recorded' : v ? 'yes' : 'no' }

function renderReport(results, { quiet, includePatientName }) {
  const L = []
  const rule = (c = '=') => L.push(c.repeat(78))

  rule()
  L.push(`3Shape scan -> IconicConnect case: ${results.length} case(s)`)
  rule()

  for (const r of results) {
    L.push('')
    rule('-')
    L.push(`${r.source.id}   [${r.source.kind}, ${r.source.fileCount} file(s)]`)
    L.push(r.source.path)
    rule('-')

    if (r.raw) {
      renderRaw(L, r, pad)
      continue
    }

    L.push('')
    L.push('FROM THE SCAN FILE')
    L.push(`  Order id ............ ${r.order.orderId ?? '-'}`)
    if (includePatientName) L.push(`  Patient ............. ${r.order.patientName ?? '-'}`)
    L.push(`  Lab / customer ...... ${r.order.customer ?? '-'}`)
    L.push(`  Manufacturer ........ ${r.order.manufacturer ?? '-'}`)
    L.push(`  Scanner client id ... ${r.order.scannerClientId ?? '-'}`)
    L.push(`  Indication .......... ${r.order.itemsSummary || '-'}`)
    L.push(`  Design module ....... ${r.order.designModuleLabel ?? '-'}`)
    L.push(`  Material / shade .... ${r.order.materialsSummary ?? '-'}${r.order.shade ? ` / ${r.order.shade}` : ''}`)
    L.push(`  Scanned ............. ${r.order.scanDate ?? '-'}`)
    L.push(`  Requested delivery .. ${r.order.deliveryDate ?? '-'}`)
    L.push(`  Scans ............... ${r.scans.map((s) => s.label).join(', ') || '-'}`)
    if (r.order.comments.trim()) {
      L.push('  Lab instructions:')
      for (const line of r.order.comments.trim().split('\n')) if (line.trim()) L.push(`      ${line.trim()}`)
    }

    if (!quiet && r.units.length) {
      L.push('')
      L.push('  Units')
      for (const u of r.units) {
        L.push(`    - ${pad(u.indication, 34)} UNN ${pad(String(u.unn ?? '?'), 3)} FDI ${pad(String(u.fdi ?? '?'), 3)} ${pad(u.arch ?? '', 6)} ${u.toothClass}`)
        if (u.material) L.push(`      material: ${u.material}`)
        if (u.implantKit) L.push(`      implant kit: ${u.implantKit}`)
      }
      if (r.connectorGroups.length) L.push(`    connected spans (UNN): ${r.connectorGroups.map((g) => g.join('-')).join(', ')}`)
    }

    if (r.scanSettings) {
      L.push('')
      L.push('  Scan settings (SID_UserInputData.XML)')
      L.push(`    articulator holder ... ${fmt(r.scanSettings.articulatorUsed)}`)
      L.push(`    closed model base .... ${fmt(r.scanSettings.closedBottom)}`)
      L.push(`    die scan steps ....... ${r.scanSettings.dieTeeth.length ? `UNN ${r.scanSettings.dieTeeth.join(', ')}` : 'none'}`)
      L.push(`    gingiva mask ......... ${fmt(r.scanSettings.hasGingivalMask)}`)
    }

    L.push('')
    L.push('CASE PAYLOAD  (POST /api/cases)')
    const p = r.casePayload
    L.push(`  category ............ ${p.category}`)
    L.push(`  caseNumber prefix ... ${p.caseNumber}`)
    L.push(`  serviceType ......... ${p.serviceType}`)
    L.push(`  clientId ............ ${p.clientId ?? '** REQUIRED — not in the scan file **'}`)
    for (const [k, v] of Object.entries(p.subTypeData)) {
      if (k === 'notes') continue
      L.push(`  subTypeData.${pad(k, 16)} ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
    }

    L.push('')
    L.push('NEEDS A HUMAN')
    if (!r.needsReview.length) L.push('  (nothing — every field was derived from the file)')
    for (const n of r.needsReview) {
      L.push(`  ! ${pad(n.field, 26)} ${Array.isArray(n.value) ? `[${n.value.join(', ')}]` : n.value}`)
      L.push(`      ${n.why}`)
    }
  }

  L.push('')
  rule()
  L.push('Reminder: case files (the .zip / scan folder) still go through the normal')
  L.push('chunked upload — this tool only derives the form fields.')
  rule()
  return L.join('\n')
}

