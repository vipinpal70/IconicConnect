import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import fs from 'node:fs'
import path from 'node:path'
import IORedis from 'ioredis'

async function main() {
  console.log('=== Starting Test Environment Cleanup ===\n')

  // 1. Supabase Auth
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found. Skipping auth user deletion.')
    } else {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      })

      console.log('Fetching users from Supabase Auth...')
      const { data, error } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000
      })

      if (error) {
        throw error
      }

      const users = data?.users || []
      console.log(`Found ${users.length} user(s) to delete from Supabase.`)

      for (const user of users) {
        console.log(`Deleting user: ${user.email} (${user.id})...`)
        const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id)
        if (deleteError) {
          console.error(`❌ Failed to delete user ${user.email}:`, deleteError.message)
        } else {
          console.log(`✅ Deleted user ${user.email}`)
        }
      }
    }
  } catch (err) {
    console.error('❌ Supabase cleanup error:', err.message || err)
  }

  console.log('\n----------------------------------------\n')

  // 2. Postgres Database Tables
  try {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set in environment.')
    }

    const sql = postgres(databaseUrl, {
      prepare: false,
      max: 1
    })

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
      console.log('No tables found in public schema to truncate.')
    } else {
      const tableNames = tables.map(t => `"${t.table_name}"`).join(', ')
      console.log(`Truncating tables: ${tableNames}...`)
      await sql.unsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`)
      console.log('✅ Database tables truncated successfully!')
    }

    await sql.end({ timeout: 5 })
  } catch (err) {
    console.error('❌ Postgres database cleanup error:', err.message || err)
  }

  console.log('\n----------------------------------------\n')

  // 3. Redis Cleanup
  try {
    const redisUrl = process.env.REDIS_URL
    if (!redisUrl) {
      console.log('REDIS_URL not found. Skipping Redis cleanup.')
    } else {
      console.log('Connecting to Redis...')
      const redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        tls: redisUrl.startsWith('rediss://') ? {} : undefined,
        enableReadyCheck: false,
      })

      console.log('Flushing Redis database...')
      await redis.flushdb()
      console.log('✅ Redis database flushed successfully!')
      redis.disconnect()
    }
  } catch (err) {
    console.error('❌ Redis cleanup error:', err.message || err)
  }

  console.log('\n----------------------------------------\n')

  // 4. Local Files Cleanup
  try {
    const caseDataDir = path.join(process.cwd(), 'case_data')
    if (!fs.existsSync(caseDataDir)) {
      console.log('case_data directory does not exist. Skipping local file cleanup.')
    } else {
      console.log('Cleaning local case files in case_data...')
      const items = fs.readdirSync(caseDataDir)
      let count = 0
      for (const item of items) {
        const itemPath = path.join(caseDataDir, item)
        if (fs.statSync(itemPath).isDirectory()) {
          fs.rmSync(itemPath, { recursive: true, force: true })
          count++
        } else {
          fs.rmSync(itemPath, { force: true })
          count++
        }
      }
      console.log(`✅ Cleaned ${count} file/directory items from case_data/`)
    }
  } catch (err) {
    console.error('❌ Local file cleanup error:', err.message || err)
  }

  console.log('\n=== Cleanup Completed Successfully! ===')
}

main().catch(err => {
  console.error('Fatal cleanup error:', err)
  process.exit(1)
})
