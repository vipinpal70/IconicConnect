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

try {
  console.log('Applying migrations from ./src/db/migrations')
  await migrate(db, { migrationsFolder: './src/db/migrations' })
  console.log('Migrations applied successfully')
} catch (error) {
  console.error('Migration failed')
  console.error(error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
