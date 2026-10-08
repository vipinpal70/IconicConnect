import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Connections per Node process. Default 3 (unchanged). Raise it with DB_POOL_MAX in .env / ecosystem.config.js
// — but keep (sum of DB_POOL_MAX over every PM2 process, web + worker + schedulers) at or below the Supabase
// pooler "Pool size" (Dashboard → Database → Connection pooling), or requests queue at the pooler.
const POOL_MAX = Math.min(Math.max(Math.floor(Number(process.env.DB_POOL_MAX)) || 3, 1), 50)

const client = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: POOL_MAX,
  idle_timeout: 20, // Close idle connections after 20 seconds
})

export const db = drizzle(client, { schema })