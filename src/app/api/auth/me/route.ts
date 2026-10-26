import { NextResponse } from 'next/server'
import { getRequestUser } from '@/src/lib/auth/request-user'

export async function GET() {
  const user = await getRequestUser()
  return NextResponse.json({ user })
}
