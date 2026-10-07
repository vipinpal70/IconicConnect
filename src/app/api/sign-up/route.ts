import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'
import { parseStoredPhone, validateNationalPhone } from '@/src/lib/phone'
import { handleProfileCreated } from '@/src/lib/price-list'
import { deleteCachedData } from '@/src/lib/redis-cache'
import { logActivity } from '@/src/lib/activity-log'
import { supabaseAdmin } from '@/src/lib/supabase/admin'
import { escapeHtml } from '@/src/lib/security/html'
import { eq, sql } from 'drizzle-orm'


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The browser creates the Auth user first, then calls this route — so the user must be brand new.
const MAX_AUTH_USER_AGE_MS = 30 * 60 * 1000

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // ── Verify the claimed identity before touching anything ──────────────────
  // `body.id` is client-supplied. Without this, anyone could post an existing user's id and (via the
  // failure cleanup below) get that user's Auth account deleted, or attach a profile to a stranger's id.
  if (typeof body.id !== 'string' || !UUID_RE.test(body.id) || typeof body.email !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { data: authLookup, error: authLookupError } = await supabaseAdmin.auth.admin.getUserById(body.id)
  const authUser = authLookup?.user
  const createdAtMs = authUser?.created_at ? new Date(authUser.created_at).getTime() : 0
  if (
    authLookupError ||
    !authUser ||
    authUser.email?.toLowerCase() !== body.email.trim().toLowerCase() ||
    Date.now() - createdAtMs > MAX_AUTH_USER_AGE_MS
  ) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const [existingProfile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, body.id)).limit(1)
  if (existingProfile) {
    // Never delete an Auth user that already has a profile — it isn't ours to clean up.
    return NextResponse.json({ error: 'An account with this email already exists. Please sign in instead.' }, { status: 409 })
  }
  // From here on this request owns a brand-new, profile-less Auth user.
  body.email = authUser.email

  // Every error path below must delete it — otherwise a failed profile save leaves an orphaned Auth user.
  const cleanupOrphanedAuthUser = async () => {
    await supabaseAdmin.auth.admin.deleteUser(body.id).catch((delErr) =>
      console.error('[sign-up] failed to clean up orphaned auth user', delErr)
    )
  }

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
      await cleanupOrphanedAuthUser()
      return NextResponse.json({ error: 'A lab with this name is already registered. Please use a more specific lab name.' }, { status: 409 })
    }

    const parsedPhone = parseStoredPhone(body.phone)
    const phoneError = validateNationalPhone(parsedPhone.countryCode, parsedPhone.nationalNumber)

    if (phoneError) {
      await cleanupOrphanedAuthUser()
      return NextResponse.json({ error: phoneError }, { status: 400 })
    }

    try {
      await db.insert(profiles).values({
        id: body.id,
        email: body.email,
        userType: 'lab_portal',   // ← hardcoded
        role: 'client',       // ← hardcoded
        status: 'pending',
        fullName: body.fullName || null,
        title: body.title || null,
        phone: body.phone || null,
        labName: body.labName?.trim() || body.fullName?.trim() || null,
        postalCode: body.postalCode || null,
        city: body.city || null,
        state: body.state || null,
        country: body.country || null,
      })
    } catch (dbError: any) {
      console.error('[sign-up] profile insert failed', dbError)
      await cleanupOrphanedAuthUser()
      if (dbError?.code === '23505') {
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
    await cleanupOrphanedAuthUser()
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}
