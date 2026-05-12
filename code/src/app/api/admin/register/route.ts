import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema'
import { isValidRoleForType } from '@/src/lib/auth/role'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // 1. Validate secret
    const secret = req.headers.get('x-admin-secret')
    if (secret !== process.env.ADMIN_SIGNUP_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { email, password, fullName, phone, role, createdBy } = body

    if (!email || !password || !role) {
      return NextResponse.json(
        { error: 'email, password and role are required' },
        { status: 400 }
      )
    }

    // 2. Validate role belongs to dental_lab_service
    if (!isValidRoleForType('dental_lab_service', role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: admin, qc, account_manager, designer` },
        { status: 400 }
      )
    }

    // 3. Create auth user
    const { data, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError || !data.user) {
      return NextResponse.json(
        { error: authError?.message ?? 'Auth creation failed' },
        { status: 400 }
      )
    }

    // 4. Insert profile
    await db.insert(profiles).values({
      id:        data.user.id,
      email,
      userType:  'admin_portal',  // ← hardcoded
      role,                             // admin | qc | account_manager | designer
      fullName:  fullName  || null,
      phone:     phone     || null,
      createdBy: createdBy || null,     // who created this team member
    })

    return NextResponse.json({ success: true, userId: data.user.id }, { status: 201 })

  } catch (err) {
    console.error('[admin/register POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}