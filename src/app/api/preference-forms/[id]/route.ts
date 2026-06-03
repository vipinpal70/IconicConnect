import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/src/db"
import { preferenceForms } from "@/src/db/schema/preference-form"
import { profiles, subUsers } from "@/src/db/schema/profile"
import { createClient } from "@/src/lib/supabase/server"
import { clonePreferenceFormPayload, type PreferenceFormPayload } from "@/src/lib/preference-forms"
import { logActivity } from "@/src/lib/activity-log"

async function getRequestContext() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)

  if (!profile) {
    return { error: NextResponse.json({ error: "Profile not found" }, { status: 404 }) }
  }

  if (profile.role === "subuser") {
    const [subUserRecord] = await db.select().from(subUsers).where(eq(subUsers.id, profile.id)).limit(1)
    if (!subUserRecord) {
      return { error: NextResponse.json({ error: "Sub-user parent client not found" }, { status: 400 }) }
    }
    return { profile, ownerClientId: subUserRecord.clientId }
  }

  return { profile, ownerClientId: profile.id }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getRequestContext()
    if ("error" in context) return context.error

    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      formName?: string
      payload?: Partial<PreferenceFormPayload>
    }

    const existing = await db
      .select()
      .from(preferenceForms)
      .where(eq(preferenceForms.id, id))
      .limit(1)

    const form = existing[0]
    if (!form) {
      return NextResponse.json({ error: "Preference form not found" }, { status: 404 })
    }

    if (form.clientId !== context.ownerClientId && context.profile.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const updateData: Partial<typeof preferenceForms.$inferInsert> = {}
    if (body.formName?.trim()) {
      updateData.formName = body.formName.trim()
    }
    if (body.payload) {
      updateData.payload = clonePreferenceFormPayload(body.payload)
    }

    const updated = await db
      .update(preferenceForms)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(preferenceForms.id, id))
      .returning()

    await logActivity({
      actor: context.profile,
      action: 'preference_form.updated',
      details: { formId: id, formName: updateData.formName ?? form.formName },
    }).catch((err) => console.error('[preference_form.updated logActivity]', err))

    return NextResponse.json({ data: updated[0] })
  } catch (error) {
    console.error("[api/preference-forms PATCH]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getRequestContext()
    if ("error" in context) return context.error

    const { id } = await params

    const existing = await db
      .select()
      .from(preferenceForms)
      .where(eq(preferenceForms.id, id))
      .limit(1)

    const form = existing[0]
    if (!form) {
      return NextResponse.json({ error: "Preference form not found" }, { status: 404 })
    }

    if (form.clientId !== context.ownerClientId && context.profile.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const deleted = await db
      .delete(preferenceForms)
      .where(eq(preferenceForms.id, id))
      .returning()

    await logActivity({
      actor: context.profile,
      action: 'preference_form.deleted',
      details: { formId: id, formName: form.formName },
    }).catch((err) => console.error('[preference_form.deleted logActivity]', err))

    return NextResponse.json({ data: deleted[0] })
  } catch (error) {
    console.error("[api/preference-forms DELETE]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    )
  }
}
