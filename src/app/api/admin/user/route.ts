

/**
 * To create a admin user headers
 * */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { db } from '@/src/db'
import { authCredentials, profiles } from '@/src/db/schema'
import { handleProfileCreated } from '@/src/lib/price-list'
import { eq } from 'drizzle-orm'
import { validatePasswordStrength } from '@/src/lib/security/password'
import { hashPassword } from '@/src/lib/auth/password-hash'
import { getRequestUser } from '@/src/lib/auth/request-user'

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

function getDatabaseErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
    return typeof error.code === 'string' ? error.code : undefined
}

export async function POST(req: NextRequest) {
    try {
        // Creating an admin requires EITHER an already-authenticated active admin
        // OR the server-side bootstrap secret (first-admin setup). Never neither.
        let authorised = secretMatches(req.headers.get('x-admin-secret'))
        if (!authorised) {
            const user = await getRequestUser()
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

        if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
            return NextResponse.json(
                { error: 'email and password are required' },
                { status: 400 }
            )
        }
        const passwordError = validatePasswordStrength(password)
        if (passwordError) {
            return NextResponse.json({ error: passwordError }, { status: 400 })
        }

        const userId = randomUUID()
        const normalizedEmail = email.trim().toLowerCase()
        const role = "admin"

        try {
            await db.transaction(async (tx) => {
                await tx.insert(authCredentials).values({
                    userId,
                    email: normalizedEmail,
                    phone: typeof phone === 'string' ? phone : null,
                    passwordHash: await hashPassword(password),
                    emailVerifiedAt: new Date(),
                })
                await tx.insert(profiles).values({
                    id: userId,
                    email: normalizedEmail,
                    userType: 'admin_portal',
                    role,
                    status: 'active',
                    fullName: typeof fullName === 'string' ? fullName : null,
                    phone: typeof phone === 'string' ? phone : null,
                })
            })
        } catch (dbError) {
            console.error('[admin/register] profile insert failed', dbError)
            if (getDatabaseErrorCode(dbError) === '23505') {
                return NextResponse.json(
                    { error: 'A user with this email already exists.' },
                    { status: 409 }
                )
            }
            return NextResponse.json(
                { error: 'Internal server error' },
                { status: 500 }
            )
        }

        // Automatically seed default catalog and client price list
        await handleProfileCreated(userId, role).catch((err) =>
            console.error('[admin/register handleProfileCreated]', err)
        )

        return NextResponse.json({ success: true, userId }, { status: 201 })

    } catch (err) {
        console.error('[admin/register POST]', err)

        // Return a clean 500 for any other catastrophic failure
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}