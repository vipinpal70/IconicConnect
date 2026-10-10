

/**
 * To create a admin user headers
 * */

import { NextRequest, NextResponse } from 'next/server'
import { createUserWithProfile, EmailTakenError } from '@/src/lib/auth/auth-service'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'
import { handleProfileCreated } from '@/src/lib/price-list'
import { timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { validatePasswordStrength } from '@/src/lib/security/password'

import { createClient as createServerClient } from '@/src/lib/auth/server'

export async function GET() {
    // check the requested user should be admin only
}

function secretMatches(provided: string | null): boolean {
    const expected = process.env.ADMIN_SIGNUP_SECRET
    // Fail closed: no configured secret, or no secret supplied, means NO bootstrap access.
    if (!expected || !provided) return false
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
    try {
        // Creating an admin requires EITHER an already-authenticated active admin
        // OR the server-side bootstrap secret (first-admin setup). Never neither.
        let authorised = secretMatches(req.headers.get('x-admin-secret'))
        if (!authorised) {
            const supabase = await createServerClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                const [caller] = await db.select({ role: profiles.role, status: profiles.status })
                    .from(profiles).where(eq(profiles.id, user.id)).limit(1)
                authorised = caller?.role === 'admin' && caller.status === 'active'
            }
        }
        if (!authorised) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await req.json()

        const { email, password, fullName, phone } = body

        if (!email || !password) {
            return NextResponse.json(
                { error: 'email and password are required' },
                { status: 400 }
            )
        }
        const passwordError = validatePasswordStrength(password)
        if (passwordError) {
            return NextResponse.json({ error: passwordError }, { status: 400 })
        }

        // 3. Credentials + profile in ONE transaction (active immediately). No orphaned account is possible.
        const role = "admin"
        let data: { user: { id: string } }
        try {
            const created = await createUserWithProfile({
                email,
                password,
                profile: { userType: 'admin_portal', role, status: 'active', fullName: fullName || null, phone: phone || null },
            })
            data = { user: { id: created.id } }
        } catch (dbError: any) {
            if (dbError instanceof EmailTakenError) {
                return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 })
            }
            console.error('[admin/register] create failed', dbError)
            return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
        }

        // Automatically seed default catalog and client price list
        await handleProfileCreated(data.user.id, role).catch((err) =>
            console.error('[admin/register handleProfileCreated]', err)
        )

        return NextResponse.json({ success: true, userId: data.user.id }, { status: 201 })

    } catch (err: any) {
        console.error('[admin/register POST]', err)

        // Return a clean 500 for any other catastrophic failure
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}