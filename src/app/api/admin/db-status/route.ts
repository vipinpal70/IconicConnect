import { NextResponse } from 'next/server'
import { createClient } from '@/src/lib/supabase/server'
import postgres from 'postgres'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
  try {
    const [catalogExists] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'service_catalog'
      ) AS exists
    `
    const migrations = await sql`
      SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 10
    `.catch(() => [])

    return NextResponse.json({
      service_catalog_exists: catalogExists.exists,
      recent_migrations: migrations,
      db_url_prefix: (process.env.DATABASE_URL ?? '').slice(0, 30) + '...',
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) })
  } finally {
    await sql.end({ timeout: 3 })
  }
}
