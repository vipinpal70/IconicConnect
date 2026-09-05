

/**
 * To create a admin user headers
 * */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'
import { handleProfileCreated } from '@/src/lib/price-list'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

import { createClient as createServerClient } from '@/src/lib/supabase/server'

export async function GET() {
    // check the requested user should be admin only
}

export async function POST(req: NextRequest) {
    try {
        // 1. Optional: Verify via Admin Secret (if you want to restrict who can sign up)
        const adminSecret = req.headers.get('x-admin-secret')
        if (adminSecret && adminSecret !== process.env.ADMIN_SIGNUP_SECRET) {
            return NextResponse.json({ error: 'Invalid admin secret' }, { status: 401 })
        }

        const body = await req.json()

        console.log(body)

        const { email, password, fullName, phone } = body

        if (!email || !password) {
            return NextResponse.json(
                { error: 'email, password and role are required' },
                { status: 400 }
            )
        }

        // 3. Create auth user — email_confirm: true skips OTP/confirmation email
        const { data, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            phone,
            email_confirm: true,
            user_metadata: { name: fullName, phone: phone, role: "admin", userType: "admin_portal" },
        })

        if (authError || !data.user) {
            return NextResponse.json(
                { error: authError?.message ?? 'Auth creation failed' },
                { status: 400 }
            )
        }

        const role = "admin"

        // 4. Insert profile — status active immediately since email is already confirmed
        try {
            await db.insert(profiles).values({
                id: data.user.id,
                email,
                userType: 'admin_portal',
                role,
                status: 'active',
                fullName: fullName || null,
                phone: phone || null,
            })
        } catch (dbError: any) {
            // The auth user above was just created — if the profile fails to save,
            // it's left as an orphaned Auth account with no matching profile. Clean
            // it up so a duplicate-email attempt doesn't leave a ghost account behind.
            console.error('[admin/register] profile insert failed', dbError)
            await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch((delErr) =>
                console.error('[admin/register] failed to clean up orphaned auth user', delErr)
            )
            if (dbError?.code === '23505') {
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