import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { profiles } from './schema/profile'

const client = postgres(process.env.DATABASE_URL!, {
  prepare: false, // Required for Supabase transaction pooler
})

export const db = drizzle(client, { schema: { profiles } })