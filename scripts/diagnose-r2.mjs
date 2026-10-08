// R2 (file storage) diagnosis — run it ON THE SERVER, in the project folder (so it reads the same .env as the app):
//
//   node scripts/diagnose-r2.mjs
//   node scripts/diagnose-r2.mjs "ANG Labs/easyytodo-logo-removebg-preview.png"     # also test one real file
//
// Read-only: it lists 1 object and (optionally) HEADs one key. It never writes or deletes.
import 'dotenv/config'
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'

const need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
console.log('\n=== 1. Environment (values hidden) ===')
let missing = 0
for (const k of need) {
  const v = process.env[k]
  console.log(`  ${k.padEnd(22)} ${v ? `set (${v.length} chars)` : '✗ MISSING'}`)
  if (!v) missing++
}
console.log(`  R2_DIRECT_DOWNLOADS    ${process.env.R2_DIRECT_DOWNLOADS ?? '(not set)'}`)
if (missing) {
  console.log('\n→ Missing R2 variables. The app builds the endpoint https://undefined.r2.cloudflarestorage.com and every file/zip download fails with 500.')
  console.log('  Fix: add them to the .env the app actually loads (the project folder PM2 runs from), then: pm2 restart iconic-connect-web --update-env')
  process.exit(1)
}

const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
console.log('\n=== 2. Clock (a skewed clock makes R2 reject every signed request) ===')
try {
  const r = await fetch(endpoint, { method: 'HEAD', signal: AbortSignal.timeout(6000) })
  const remote = new Date(r.headers.get('date') ?? '')
  const skew = Math.round((Date.now() - remote.getTime()) / 1000)
  console.log(`  server clock vs R2: ${skew > 0 ? '+' : ''}${skew}s  ${Math.abs(skew) > 300 ? '✗ too far off (limit 15 min) — fix with: timedatectl set-ntp true' : '✓'}`)
} catch (e) { console.log(`  ✗ cannot reach ${endpoint}: ${e.cause?.code ?? e.message}`) }

const r2 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

const explain = (e) => {
  const code = e.name || e.Code || e.code
  const http = e.$metadata?.httpStatusCode
  const hints = {
    InvalidAccessKeyId: 'The access key id is wrong or was deleted in the Cloudflare dashboard.',
    SignatureDoesNotMatch: 'The secret key is wrong (or has stray spaces/quotes), or the clock is off.',
    AccessDenied: 'The API token has no permission on this bucket (needs Object Read at least).',
    NoSuchBucket: 'R2_BUCKET does not exist in this account — check the bucket name.',
    RequestTimeTooSkewed: 'Server clock is off — enable NTP.',
    NotFound: 'That object does not exist in R2 (the app would answer 404, not 500).',
    NoSuchKey: 'That object does not exist in R2 (the app would answer 404, not 500).',
    ENOTFOUND: 'DNS cannot resolve the endpoint — R2_ACCOUNT_ID is wrong.',
    ECONNREFUSED: 'The server cannot open the connection (firewall / network).',
  }
  return `${code ?? 'error'}${http ? ` (HTTP ${http})` : ''}: ${e.message}${hints[code] ? `\n      → ${hints[code]}` : ''}`
}

console.log('\n=== 3. List one object in the bucket ===')
try {
  const out = await r2.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, MaxKeys: 1 }))
  console.log(`  ✓ credentials + bucket work. Example key: ${out.Contents?.[0]?.Key ?? '(bucket is empty)'}`)
} catch (e) { console.log('  ✗ ' + explain(e)) }

const key = process.argv[2]
if (key) {
  console.log(`\n=== 4. HEAD "${key}" ===`)
  try {
    const out = await r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
    console.log(`  ✓ exists, ${out.ContentLength} bytes, ${out.ContentType}`)
  } catch (e) { console.log('  ✗ ' + explain(e)) }
}
console.log('\nIf all of this is ✓ but the app still returns 500, the app process is not reading this .env (PM2 was started from another folder).')
console.log('Then run:  pm2 describe iconic-connect-web | grep -E "exec cwd|script path"   and make sure exec cwd is the project folder.\n')
