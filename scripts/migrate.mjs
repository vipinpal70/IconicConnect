import crypto from 'node:crypto'
import fs from 'node:fs'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
})

const db = drizzle(sql)

function loadJournalEntries() {
  const journal = JSON.parse(
    fs.readFileSync('./src/db/migrations/meta/_journal.json', 'utf8')
  )

  return journal.entries
}

function getMigrationHash(tag) {
  const query = fs.readFileSync(`./src/db/migrations/${tag}.sql`, 'utf8')
  return crypto.createHash('sha256').update(query).digest('hex')
}

async function bootstrapExistingProductionSchema() {
  const [migrationCountRow] = await sql`
    select count(*)::int as count
    from drizzle.__drizzle_migrations
  `

  if ((migrationCountRow?.count ?? 0) > 0) {
    return
  }

  const [schemaState] = await sql`
    select
      exists (
        select 1
        from pg_type
        where typname = 'plan_status'
      ) as has_plan_status,
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = 'cases'
      ) as has_cases_table,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'cases' and column_name = 'patient_name'
      ) as has_patient_name,
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = 'activity_logs'
      ) as has_activity_logs
  `

  const shouldBaselineInitialMigrations =
    schemaState?.has_plan_status &&
    schemaState?.has_cases_table &&
    schemaState?.has_patient_name &&
    !schemaState?.has_activity_logs

  if (!shouldBaselineInitialMigrations) {
    return
  }

  console.log('Bootstrapping existing production schema into drizzle migration history')

  const initialEntries = loadJournalEntries().filter((entry) => entry.idx <= 3)

  for (const entry of initialEntries) {
    await sql`
      insert into drizzle.__drizzle_migrations ("hash", "created_at")
      values (${getMigrationHash(entry.tag)}, ${entry.when})
    `
  }
}

try {
  console.log('Applying migrations from ./src/db/migrations')
  await sql`create schema if not exists drizzle`
  await sql`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `
  await bootstrapExistingProductionSchema()
  await migrate(db, { migrationsFolder: './src/db/migrations' })
  console.log('Migrations applied successfully')
} catch (error) {
  console.error('Migration failed')
  console.error(error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
