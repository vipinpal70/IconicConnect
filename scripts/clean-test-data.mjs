import 'dotenv/config'
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {};
}
import { createClient } from '@supabase/supabase-js'
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import IORedis from 'ioredis'

// Full-reset script — wipes Supabase Auth, every table in the Postgres
// `public` schema (structure/migrations stay intact — only rows go),
// Redis, the Cloudflare R2 bucket, the Supabase Storage `case-files`
// bucket, and local case_data/ files. This is the ONLY thing this script
// does; there is no partial/selective mode. Irreversible — everything
// below exists to make sure that's never a surprise.
//
// Usage:
//   node scripts/clean-test-data.mjs              interactive — asks for a
//                                                  typed confirmation phrase
//   node scripts/clean-test-data.mjs --yes        skips the prompt (CI use —
//                                                  make sure the calling
//                                                  context already confirmed
//                                                  the target environment)
//   node scripts/clean-test-data.mjs --dry-run    reports what would be
//                                                  deleted from every system,
//                                                  deletes nothing

const CONFIRMATION_PHRASE = 'DELETE EVERYTHING'
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const skipPrompt = args.has('--yes') || args.has('-y')

function redactedDbTarget(databaseUrl) {
  try {
    const u = new URL(databaseUrl)
    return `${u.hostname}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

async function confirm() {
  console.log('\n=====================================================')
  console.log('  FULL RESET — this deletes ALL DATA, permanently')
  console.log('=====================================================')
  console.log(`  Postgres target : ${process.env.DATABASE_URL ? redactedDbTarget(process.env.DATABASE_URL) : '(DATABASE_URL not set)'}`)
  console.log(`  Supabase project: ${process.env.NEXT_PUBLIC_SUPABASE_URL || '(not set)'}`)
  console.log(`  R2 bucket       : ${process.env.R2_BUCKET || '(not set)'}`)
  console.log(`  Redis           : ${process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : '(not set)'}`)
  console.log('-----------------------------------------------------')
  console.log('  This will permanently remove:')
  console.log('   - every Supabase Auth user')
  console.log('   - every row in every table in the Postgres public schema')
  console.log('   - the entire Redis cache')
  console.log('   - every object in the R2 bucket above')
  console.log('   - every object in the Supabase Storage "case-files" bucket')
  console.log('   - the local case_data/ directory')
  console.log('=====================================================\n')

  if (dryRun) {
    console.log('DRY RUN — nothing above will actually be touched.\n')
    return true
  }
  if (skipPrompt) {
    console.log('--yes passed — skipping the interactive confirmation prompt.\n')
    return true
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => {
    rl.question(`Type "${CONFIRMATION_PHRASE}" to proceed, or anything else to abort: `, resolve)
  })
  rl.close()

  if (answer.trim() !== CONFIRMATION_PHRASE) {
    console.log('\nConfirmation phrase did not match. Aborting — nothing was touched.')
    return false
  }
  console.log('')
  return true
}

async function cleanSupabaseAuth() {
  console.log('--- Supabase Auth ---')
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found. Skipping auth user deletion.\n')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('Fetching users from Supabase Auth...')
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error

  const users = data?.users || []
  console.log(`Found ${users.length} user(s).`)

  if (dryRun) {
    console.log('DRY RUN — no users deleted.\n')
    return
  }

  for (const user of users) {
    console.log(`Deleting user: ${user.email} (${user.id})...`)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id)
    if (deleteError) {
      console.error(`❌ Failed to delete user ${user.email}:`, deleteError.message)
    } else {
      console.log(`✅ Deleted user ${user.email}`)
    }
  }
  console.log('')
}

async function cleanPostgres() {
  console.log('--- Postgres (public schema) ---')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in environment.')
  }

  const sql = postgres(databaseUrl, { prepare: false, max: 1 })
  try {
    console.log('Fetching all tables in public schema...')
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE 'pg_%'
        AND table_name NOT LIKE 'sql_%'
    `

    if (tables.length === 0) {
      console.log('No tables found in public schema to truncate.\n')
      return
    }

    const tableNames = tables.map((t) => `"${t.table_name}"`).join(', ')
    if (dryRun) {
      console.log(`DRY RUN — would truncate ${tables.length} table(s): ${tableNames}\n`)
      return
    }

    console.log(`Truncating tables: ${tableNames}...`)
    await sql.unsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`)
    console.log('✅ Database tables truncated successfully! (schema/migrations untouched)\n')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function cleanRedis() {
  console.log('--- Redis ---')
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.log('REDIS_URL not found. Skipping Redis cleanup.\n')
    return
  }

  if (dryRun) {
    console.log(`DRY RUN — would flush Redis at ${new URL(redisUrl).hostname}.\n`)
    return
  }

  console.log('Connecting to Redis...')
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    enableReadyCheck: false,
  })

  console.log('Flushing Redis database...')
  await redis.flushdb()
  console.log('✅ Redis database flushed successfully!\n')
  redis.disconnect()
}

async function cleanR2Bucket() {
  console.log('--- Cloudflare R2 bucket ---')
  const bucket = process.env.R2_BUCKET
  if (!bucket || !process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    console.warn('⚠️  R2 env vars not fully set. Skipping R2 cleanup.\n')
    return
  }

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })

  console.log(`Listing objects in bucket "${bucket}"...`)
  const keys = []
  let continuationToken
  do {
    const res = await r2.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken, MaxKeys: 1000 })
    )
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key)
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)

  console.log(`Found ${keys.length} object(s).`)
  if (dryRun) {
    console.log('DRY RUN — no R2 objects deleted.\n')
    return
  }
  if (keys.length === 0) {
    console.log('')
    return
  }

  let deleted = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    const res = await r2.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } })
    )
    deleted += batch.length - (res.Errors?.length ?? 0)
    for (const err of res.Errors ?? []) {
      console.error(`❌ Failed to delete ${err.Key}: ${err.Code} ${err.Message}`)
    }
  }
  console.log(`✅ Deleted ${deleted}/${keys.length} R2 object(s).\n`)
}

async function listAllStorageFiles(supabase, bucket, dirPath = '') {
  const { data, error } = await supabase.storage.from(bucket).list(dirPath, { limit: 1000 })
  if (error) throw error

  let files = []
  for (const entry of data ?? []) {
    const fullPath = dirPath ? `${dirPath}/${entry.name}` : entry.name
    // A Supabase Storage "folder" entry has no id/metadata — recurse into it.
    if (entry.id === null) {
      files = files.concat(await listAllStorageFiles(supabase, bucket, fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

async function cleanSupabaseStorage() {
  console.log('--- Supabase Storage ("case-files" bucket) ---')
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found. Skipping Supabase Storage cleanup.\n')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('Listing files in "case-files"...')
  const files = await listAllStorageFiles(supabase, 'case-files')
  console.log(`Found ${files.length} file(s).`)

  if (dryRun) {
    console.log('DRY RUN — no Supabase Storage files deleted.\n')
    return
  }
  if (files.length === 0) {
    console.log('')
    return
  }

  let deleted = 0
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100)
    const { data, error } = await supabase.storage.from('case-files').remove(batch)
    if (error) {
      console.error('❌ Failed to delete a batch of Supabase Storage files:', error.message)
    } else {
      deleted += data?.length ?? batch.length
    }
  }
  console.log(`✅ Deleted ${deleted}/${files.length} Supabase Storage file(s).\n`)
}

async function cleanLocalFiles() {
  console.log('--- Local case_data/ ---')
  const caseDataDir = path.join(process.cwd(), 'case_data')
  if (!fs.existsSync(caseDataDir)) {
    console.log('case_data directory does not exist. Skipping.\n')
    return
  }

  const items = fs.readdirSync(caseDataDir)
  if (dryRun) {
    console.log(`DRY RUN — would remove ${items.length} item(s) from case_data/.\n`)
    return
  }

  let count = 0
  for (const item of items) {
    const itemPath = path.join(caseDataDir, item)
    fs.rmSync(itemPath, { recursive: true, force: true })
    count++
  }
  console.log(`✅ Cleaned ${count} file/directory item(s) from case_data/\n`)
}

async function main() {
  const proceed = await confirm()
  if (!proceed) {
    process.exit(1)
  }

  console.log(`=== ${dryRun ? 'Dry Run' : 'Full Reset'} Starting ===\n`)

  const steps = [
    cleanSupabaseAuth,
    cleanPostgres,
    cleanRedis,
    cleanR2Bucket,
    cleanSupabaseStorage,
    cleanLocalFiles,
  ]

  for (const step of steps) {
    try {
      await step()
    } catch (err) {
      console.error(`❌ ${step.name} failed:`, err.message || err)
      console.log('')
    }
  }

  console.log(`=== ${dryRun ? 'Dry Run' : 'Full Reset'} Completed ===`)
}

main().catch((err) => {
  console.error('Fatal cleanup error:', err)
  process.exit(1)
})
