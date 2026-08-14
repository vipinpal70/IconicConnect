import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { millingCenters } from '@/src/db/schema/milling'
import { requireAdmin } from '@/src/lib/milling/admin-guard'
import { logActivity } from '@/src/lib/activity-log'

async function getCenter(id: string) {
  const [center] = await db.select().from(millingCenters).where(eq(millingCenters.id, id)).limit(1)
  return center ?? null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const center = await getCenter(id)
    if (!center) {
      return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 })
    }
    return NextResponse.json({ data: center })
  } catch (error) {
    console.error('[admin/milling/centers/[id] GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const existing = await getCenter(id)
    if (!existing) {
      return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 })
    }

    const body = await req.json()
    const {
      name, contactName, email, phone, city, state, country, active,
      legalName, ownerName, ownerEmail, ownerPhone,
      financePocName, financePocEmail, financePocPhone,
      statesServed, avgTatDays, enabledServiceTypes,
    } = body

    const updates: Partial<typeof millingCenters.$inferInsert> = { updatedAt: new Date() }
    if (typeof name === 'string') updates.name = name
    if (contactName !== undefined) updates.contactName = contactName || null
    if (email !== undefined) updates.email = email || null
    if (phone !== undefined) updates.phone = phone || null
    if (city !== undefined) updates.city = city || null
    if (state !== undefined) updates.state = state || null
    if (country !== undefined) updates.country = country || null
    if (typeof active === 'boolean') updates.active = active
    if (legalName !== undefined) updates.legalName = legalName || null
    if (ownerName !== undefined) updates.ownerName = ownerName || null
    if (ownerEmail !== undefined) updates.ownerEmail = ownerEmail || null
    if (ownerPhone !== undefined) updates.ownerPhone = ownerPhone || null
    if (financePocName !== undefined) updates.financePocName = financePocName || null
    if (financePocEmail !== undefined) updates.financePocEmail = financePocEmail || null
    if (financePocPhone !== undefined) updates.financePocPhone = financePocPhone || null
    if (statesServed !== undefined) {
      updates.statesServed = Array.isArray(statesServed) && statesServed.length ? statesServed : null
    }
    if (avgTatDays !== undefined) updates.avgTatDays = avgTatDays === null || avgTatDays === '' ? null : Number(avgTatDays)
    if (Array.isArray(enabledServiceTypes)) updates.enabledServiceTypes = enabledServiceTypes

    const [center] = await db
      .update(millingCenters)
      .set(updates)
      .where(eq(millingCenters.id, id))
      .returning()

    await logActivity({
      actor: auth.profile,
      action: 'milling_center.updated',
      details: { centerId: id, changes: updates },
    }).catch((err) => console.error('[milling_center.updated logActivity]', err))

    return NextResponse.json({ data: center })
  } catch (error) {
    console.error('[admin/milling/centers/[id] PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Milling centres are deactivated, not hard-deleted — routing rules, service
// catalog rows, and case assignments reference them and should stay intact
// for historical/audit purposes.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const existing = await getCenter(id)
    if (!existing) {
      return NextResponse.json({ error: 'Milling centre not found' }, { status: 404 })
    }

    const [center] = await db
      .update(millingCenters)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(millingCenters.id, id))
      .returning()

    await logActivity({
      actor: auth.profile,
      action: 'milling_center.deactivated',
      details: { centerId: id },
    }).catch((err) => console.error('[milling_center.deactivated logActivity]', err))

    return NextResponse.json({ data: center })
  } catch (error) {
    console.error('[admin/milling/centers/[id] DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
