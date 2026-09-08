/* Throwaway end-to-end harness for src/lib/three-shape against the sample zips.
 * Run: npx tsx scripts/verify-3shape.ts [dir]   (default dir: case_data) */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { bufferRangeReader } from '../src/lib/three-shape/zip'
import { extractPackage } from '../src/lib/three-shape/package'

function findZips(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const s = statSync(p)
    if (s.isDirectory()) findZips(p, acc)
    else if (e.toLowerCase().endsWith('.zip')) acc.push(p)
  }
  return acc
}

async function main() {
  const root = process.argv[2] || 'case_data'
  const zips = findZips(root).sort()
  console.log(`Found ${zips.length} zip(s) under ${root}\n`)

  for (const path of zips) {
    const name = path.split('/').pop() as string
    const buf = readFileSync(path)
    const res = await extractPackage(bufferRangeReader(buf), name)
    console.log('='.repeat(78))
    console.log(name, `(${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
    if (!res.ok) {
      console.log(`  ERROR ${res.error.code}: ${res.error.message}`)
      continue
    }
    const d = res.draft
    const ts = res.threeShape
    console.log(`  category      : ${d.category ?? '(manual pick)'}  [script: ${d.scriptCategory}]`)
    console.log(
      `  subTypeData   : ${JSON.stringify({ ...d.subTypeData, notes: d.subTypeData.notes ? '…' : '' })}`,
    )
    console.log(`  toothNumbers  : [${ts.classification.toothNumbers.join(', ')}]`)
    console.log(
      `  components    : ${ts.classification.components
        .map((c) => `${c.type}(${c.toothNumbers.join(',')})`)
        .join('  ')}`,
    )
    console.log(`  connectorSpans: ${JSON.stringify(ts.relationships.connectorSpans)}`)
    console.log(`  sourceOrderId : ${ts.sourceIds.sourceOrderId}`)
    console.log(`  requiresReview: ${ts.dataQuality.requiresReview}`)
    for (const w of ts.dataQuality.warnings) console.log(`    - ${w.code}${w.field ? ` (${w.field})` : ''}`)
  }
}

void main()
