import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const client = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 3,          // Limit connections per process (4 processes × 3 = 12, within Supabase pool_size: 15)
  idle_timeout: 20, // Close idle connections after 20 seconds
})

export const db = drizzle(client, { schema })