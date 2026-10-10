import { NextResponse } from 'next/server'
import { createClient } from '@/src/lib/auth/server'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.json({ success: true })
}
