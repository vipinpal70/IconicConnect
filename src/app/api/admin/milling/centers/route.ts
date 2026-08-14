import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { millingCenters } from '@/src/db/schema/milling'
import { desc } from 'drizzle-orm'
import { requireAdmin, requireStaffRole } from '@/src/lib/milling/admin-guard'
import { logActivity } from '@/src/lib/activity-log'
import { createMillingUser } from '@/src/lib/milling/create-milling-user'

// Read-only: qc/designer also need the active centre list to assign a
// Design+Milling case from the case list once it's approved.
export async function GET() {
  const auth = await requireStaffRole(['admin', 'qc', 'designer'])
  if ('error' in auth) return auth.error

  try {
    const centers = await db.select().from(millingCenters).orderBy(desc(millingCenters.createdAt))
    return NextResponse.json({ data: centers })
  } catch (error) {
    console.error('[admin/milling/centers GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const body = await req.json()
    const {
      name, contactName, email, phone, city, state, country, password,
      legalName, ownerName, ownerEmail, ownerPhone,
      financePocName, financePocEmail, financePocPhone,
    } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Centre name is required' }, { status: 400 })
    }

    // Creating a first login at onboarding time requires an email to sign in with.
    if (password && !email) {
      return NextResponse.json({ error: 'Email is required to create a login for this centre' }, { status: 400 })
    }

    const [center] = await db
      .insert(millingCenters)
      .values({
        name,
        legalName: legalName || null,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        ownerName: ownerName || null,
        ownerEmail: ownerEmail || null,
        ownerPhone: ownerPhone || null,
        financePocName: financePocName || null,
        financePocEmail: financePocEmail || null,
        financePocPhone: financePocPhone || null,
        city: city || null,
        state: state || null,
        country: country || null,
        onboardedAt: new Date().toISOString().slice(0, 10),
      })
      .returning()

    await logActivity({
      actor: auth.profile,
      action: 'milling_center.created',
      details: { centerId: center.id, name: center.name },
    }).catch((err) => console.error('[milling_center.created logActivity]', err))

    // Optional: create the centre's first milling_admin login in the same step.
    // The centre row above is already committed, so a failure here is reported
    // as a warning rather than failing the whole request — admin can still add
    // the login afterwards via "Manage" on the centre.
    let user: Awaited<ReturnType<typeof createMillingUser>> | null = null
    let userError: string | null = null
    if (password) {
      try {
        user = await createMillingUser({
          email,
          password,
          fullName: contactName || name,
          role: 'milling_admin',
          millingCenterId: center.id,
          centerName: center.name,
          phone,
          actor: auth.profile,
        })
      } catch (err) {
        userError = err instanceof Error ? err.message : 'Failed to create login'
        console.error('[admin/milling/centers POST] createMillingUser failed', err)
      }
    }

    return NextResponse.json({ data: center, user, userError }, { status: 201 })
  } catch (error) {
    console.error('[admin/milling/centers POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
