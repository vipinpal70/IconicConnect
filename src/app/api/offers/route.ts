import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { db } from "@/src/db"
import { offers } from "@/src/db/schema/offer"
import { profiles } from "@/src/db/schema/profile"
import { createClient } from "@/src/lib/supabase/server"
import { notifyOfferCreated } from "@/src/lib/notifications/notification-dispatcher"
import { isValidRoleForType } from "@/src/lib/auth/role"
import { isOfferCategory } from "@/src/lib/offers"

type OfferInput = {
  id?: string
  title?: string
  brand?: string
  category?: string
  description?: string
  discount?: string
  validTill?: string
  sponsored?: boolean
  active?: boolean
  targetClients?: string[]
  targetLocations?: string[]
}

async function getCurrentUserProfile() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { user: null, profile: null, error: "Unauthorized" as const }
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
  if (!profile) {
    return { user, profile: null, error: "Profile not found" as const }
  }

  return { user, profile, error: null}
}

function normalizeTargets(value: string[] | undefined) {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : []
}

async function updateOffer(req: NextRequest) {
  const userContext = await getCurrentUserProfile()

  if (userContext.error === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!userContext.profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 })
  }

  if (!isValidRoleForType("admin_portal", userContext.profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "Offer id is required" }, { status: 400 })
  }

  const [current] = await db.select().from(offers).where(eq(offers.id, id)).limit(1)
  if (!current) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as OfferInput
  const title = body.title?.trim() || current.title
  const brand = body.brand?.trim() || current.brand
  const category = body.category?.trim() || current.category
  const description = body.description?.trim() || current.description
  const discount = body.discount?.trim() || current.discount
  const validTill = body.validTill?.trim() || current.validTill
  const sponsored = typeof body.sponsored === "boolean" ? body.sponsored : current.sponsored
  const active = typeof body.active === "boolean" ? body.active : current.active
  const targetClients =
    body.targetClients !== undefined ? normalizeTargets(body.targetClients) : current.targetClients
  const targetLocations =
    body.targetLocations !== undefined ? normalizeTargets(body.targetLocations) : current.targetLocations

  if (!title) {
    return NextResponse.json({ error: "Offer title is required" }, { status: 400 })
  }
  if (!brand) {
    return NextResponse.json({ error: "Brand is required" }, { status: 400 })
  }
  if (!isOfferCategory(category)) {
    return NextResponse.json({ error: "Choose a valid offer category" }, { status: 400 })
  }
  if (!description) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 })
  }
  if (!discount) {
    return NextResponse.json({ error: "Discount text is required" }, { status: 400 })
  }
  if (!validTill) {
    return NextResponse.json({ error: "Valid till date is required" }, { status: 400 })
  }

  const [updated] = await db
    .update(offers)
    .set({
      title,
      brand,
      category,
      description,
      discount,
      validTill,
      sponsored,
      active,
      targetClients,
      targetLocations,
      updatedAt: new Date(),
    })
    .where(eq(offers.id, id))
    .returning()

  return NextResponse.json({ data: updated })
}

export async function GET() {
  try {
    const userContext = await getCurrentUserProfile()

    if (userContext.error === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!userContext.profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const isAdmin = isValidRoleForType("admin_portal", userContext.profile.role)
    const rows = isAdmin
      ? await db.select().from(offers).orderBy(desc(offers.createdAt))
      : await db.select().from(offers).where(eq(offers.active, true)).orderBy(desc(offers.createdAt))
    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error("[api/offers GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userContext = await getCurrentUserProfile()

    if (userContext.error === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!userContext.profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    if (!isValidRoleForType("admin_portal", userContext.profile.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as OfferInput
    const title = body.title?.trim() ?? ""
    const brand = body.brand?.trim() ?? ""
    const category = body.category?.trim() ?? ""
    const description = body.description?.trim() ?? ""
    const discount = body.discount?.trim() ?? ""
    const validTill = body.validTill?.trim() ?? ""
    const sponsored = Boolean(body.sponsored)
    const active = body.active !== undefined ? Boolean(body.active) : true
    const targetClients = normalizeTargets(body.targetClients)
    const targetLocations = normalizeTargets(body.targetLocations)

    if (!title) {
      return NextResponse.json({ error: "Offer title is required" }, { status: 400 })
    }
    if (!brand) {
      return NextResponse.json({ error: "Brand is required" }, { status: 400 })
    }
    if (!isOfferCategory(category)) {
      return NextResponse.json({ error: "Choose a valid offer category" }, { status: 400 })
    }
    if (!description) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 })
    }
    if (!discount) {
      return NextResponse.json({ error: "Discount text is required" }, { status: 400 })
    }
    if (!validTill) {
      return NextResponse.json({ error: "Valid till date is required" }, { status: 400 })
    }

    const [inserted] = await db
      .insert(offers)
      .values({
        title,
        brand,
        category,
        description,
        discount,
        validTill,
        sponsored,
        active,
        targetClients,
        targetLocations,
      })
      .returning()

    await notifyOfferCreated({
      actorUserId: userContext.user.id,
      offerId: inserted.id,
      title: inserted.title,
      brand: inserted.brand,
      discount: inserted.discount,
      category: inserted.category,
    })

    return NextResponse.json({ data: inserted }, { status: 201 })
  } catch (error) {
    console.error("[api/offers POST]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userContext = await getCurrentUserProfile()

    if (userContext.error === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!userContext.profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    if (!isValidRoleForType("admin_portal", userContext.profile.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Offer id is required" }, { status: 400 })
    }

    const deleted = await db.delete(offers).where(eq(offers.id, id)).returning({ id: offers.id })

    if (!deleted.length) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 })
    }

    return NextResponse.json({ data: deleted[0] })
  } catch (error) {
    console.error("[api/offers DELETE]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    return await updateOffer(req)
  } catch (error) {
    console.error("[api/offers PATCH]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
