import { NextResponse } from 'next/server'
import { createClient } from '@/src/lib/auth/server'

export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(user)
}
