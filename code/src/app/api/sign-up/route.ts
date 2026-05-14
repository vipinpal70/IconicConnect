import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    await db.insert(profiles).values({
      id: body.id,
      email: body.email,
      userType: 'lab_portal',   // ← hardcoded
      role: 'client',       // ← hardcoded
      status: 'pending',
      fullName: body.fullName || null,
      title: body.title || null,
      phone: body.phone || null,
      labName: body.labName || null,
      postalCode: body.postalCode || null,
      city: body.city || null,
      state: body.state || null,
      country: body.country || null,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('[profiles/POST]', err)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}

