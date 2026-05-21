import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { db } from "@/src/db"
import { profiles } from "@/src/db/schema/profile"
import { preferenceForms } from "@/src/db/schema/preference-form"
import { createClient } from "@/src/lib/supabase/server"
import { clonePreferenceFormPayload, type PreferenceFormPayload } from "@/src/lib/preference-forms"

async function getRequestContext(clientId?: string | null) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)

  if (!profile) {
    return { error: NextResponse.json({ error: "Profile not found" }, { status: 404 }) }
  }

  const isAdmin = profile.role === "admin"
  const resolvedClientId = clientId || profile.id

  if (!isAdmin && resolvedClientId !== profile.id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  return { profile, isAdmin, resolvedClientId }
}

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get("clientId")
    const context = await getRequestContext(clientId)

    if ("error" in context) {
      return context.error
    }

    const forms = await db
      .select()
      .from(preferenceForms)
      .where(eq(preferenceForms.clientId, context.resolvedClientId))
      .orderBy(desc(preferenceForms.createdAt))

    return NextResponse.json({ data: forms })
  } catch (error) {
    console.error("[api/preference-forms GET]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await getRequestContext()

    if ("error" in context) {
      return context.error
    }

    const body = (await req.json().catch(() => ({}))) as {
      formName?: string
      payload?: Partial<PreferenceFormPayload>
    }

    const formName = body.formName?.trim()
    if (!formName) {
      return NextResponse.json({ error: "Form name is required" }, { status: 400 })
    }

    const payload = clonePreferenceFormPayload(body.payload)

    const inserted = await db
      .insert(preferenceForms)
      .values({
        id: crypto.randomUUID(),
        clientId: context.profile.id,
        formName,
        payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    return NextResponse.json({ data: inserted[0] }, { status: 201 })
  } catch (error) {
    console.error("[api/preference-forms POST]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    )
  }
}
