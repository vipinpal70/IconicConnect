import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'
import { authCredentials } from '@/src/db/schema/auth-credentials'
import { parseStoredPhone, validateNationalPhone } from '@/src/lib/phone'
import { handleProfileCreated } from '@/src/lib/price-list'
import { deleteCachedData } from '@/src/lib/redis-cache'
import { logActivity } from '@/src/lib/activity-log'
import type { ServiceType } from '@/src/lib/case-status-mapping'
import { escapeHtml } from '@/src/lib/security/html'
import { sql } from 'drizzle-orm'
import { hashPassword } from '@/src/lib/auth/password-hash'

const VALID_SERVICE_TYPES: ServiceType[] = ['design_only', 'design_milling', 'milling_only']

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function getDatabaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (
    typeof body.email !== 'string' ||
    typeof body.password !== 'string' ||
    body.email.trim().length === 0 ||
    body.email.length > 254 ||
    body.password.length < 10 ||
    body.password.length > 256
  ) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const email = body.email.trim().toLowerCase()
  const [existingAccount] = await db.select({ userId: authCredentials.userId })
    .from(authCredentials)
    .where(sql`lower(${authCredentials.email}) = ${email}`)
    .limit(1)
  const [existingProfile] = await db.select({ id: profiles.id }).from(profiles)
    .where(sql`lower(${profiles.email}) = ${email}`)
    .limit(1)
  if (existingAccount || existingProfile) {
    return NextResponse.json({ error: 'An account with this email already exists. Please sign in instead.' }, { status: 409 })
  }
  const userId = randomUUID()
  body.id = userId
  body.email = email

  try {
    body.fullName = clip(body.fullName, 150)
    body.labName = clip(body.labName, 150)
    body.title = clip(body.title, 100)
    body.postalCode = clip(body.postalCode, 20)
    body.city = clip(body.city, 100)
    body.state = clip(body.state, 100)
    body.country = clip(body.country, 100)

    // Lab name doubles as the storage folder (labName/fileName in R2) — two labs sharing one name would
    // share files. Reject a name that's already taken (case-insensitive, same fallback chain as the folder).
    const folderName = body.labName || body.fullName || String(body.email)
    const [nameTaken] = await db.select({ id: profiles.id }).from(profiles).where(
      sql`lower(coalesce(nullif(trim(${profiles.labName}), ''), nullif(trim(${profiles.fullName}), ''), ${profiles.email})) = lower(${folderName})`
    ).limit(1)
    if (nameTaken) {
      return NextResponse.json({ error: 'A lab with this name is already registered. Please use a more specific lab name.' }, { status: 409 })
    }

    const parsedPhone = parseStoredPhone(body.phone)
    const phoneError = validateNationalPhone(parsedPhone.countryCode, parsedPhone.nationalNumber)

    if (phoneError) {
      return NextResponse.json({ error: phoneError }, { status: 400 })
    }

    const rawServiceTypes: unknown[] = Array.isArray(body.enabledServiceTypes) ? body.enabledServiceTypes : []
    const enabledServiceTypes = rawServiceTypes.filter((t): t is ServiceType => VALID_SERVICE_TYPES.includes(t as ServiceType))

    if (enabledServiceTypes.length === 0) {
      return NextResponse.json({ error: 'Please select at least one service you need (Design, Design + Milling, or Milling).' }, { status: 400 })
    }

    try {
      const passwordHash = await hashPassword(body.password)
      await db.transaction(async (tx) => {
        await tx.insert(authCredentials).values({
          userId,
          email,
          phone: body.phone || null,
          passwordHash,
        })
        await tx.insert(profiles).values({
          id: userId,
          email,
          userType: 'lab_portal',
          role: 'client',
          status: 'pending',
          fullName: body.fullName || null,
          title: body.title || null,
          phone: body.phone || null,
          labName: body.labName?.trim() || body.fullName?.trim() || null,
          postalCode: body.postalCode || null,
          city: body.city || null,
          state: body.state || null,
          country: body.country || null,
          enabledServiceTypes,
        })
      })
    } catch (dbError) {
      console.error('[sign-up] profile insert failed', dbError)
      if (getDatabaseErrorCode(dbError) === '23505') {
        return NextResponse.json({ error: 'An account with this email already exists. Please sign in instead.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
    }

    // Automatically ensure default catalog exists and seed the client's allocated price list
    await handleProfileCreated(body.id, 'client').catch((err) =>
      console.error('[sign-up handleProfileCreated]', err)
    )

    // Bust the admin clients-list cache so the new registration shows up immediately
    await deleteCachedData('clients:list').catch((err) =>
      console.error('[sign-up deleteCachedData]', err)
    )

    // Record the submitted sign-up form data in the activity log
    await logActivity({
      actor: { id: body.id, userType: 'lab_portal', role: 'client', fullName: body.fullName || null, labName: body.labName || null },
      action: 'client.registered',
      details: {
        email: body.email,
        fullName: body.fullName || null,
        title: body.title || null,
        phone: body.phone || null,
        labName: body.labName || null,
        postalCode: body.postalCode || null,
        city: body.city || null,
        state: body.state || null,
        country: body.country || null,
        enabledServiceTypes,
      },
    }).catch((err) => console.error('[sign-up logActivity]', err))

    // Notify admins about new client registration
    try {
      const { notifyClientRegistered } = await import('@/src/lib/notifications/notification-dispatcher')
      await notifyClientRegistered({
        clientId: body.id,
        clientName: body.fullName || body.email,
        labName: body.labName || null,
        email: body.email,
      })
    } catch (err) {
      console.error('Failed to notify admin on new client onboarding:', err)
    }

    // Queue welcome email
    try {
      const { queueEmail } = await import('@/src/lib/queue/jobs');
      await queueEmail({
        to: body.email,
        subject: 'Welcome to IconicConnect!',
        type: 'welcome',
        html: `
          <h1>Welcome, ${escapeHtml(body.fullName || body.email)}!</h1>
          <p>Thank you for signing up with IconicConnect. Your account is currently <strong>pending approval</strong>.</p>
          <p>We will notify you as soon as your account is activated.</p>
        `
      });
    } catch (queueError) {
      console.error('Failed to queue welcome email:', queueError);
      // Don't fail the sign-up if email queuing fails
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('[profiles/POST]', err)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}
