import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/src/db"
import { offerClaims, offers } from "@/src/db/schema/offer"
import { profiles } from "@/src/db/schema/profile"
import { createClient } from "@/src/lib/supabase/server"
import { isValidRoleForType } from "@/src/lib/auth/role"
import { type OfferClaimRecord } from "@/src/lib/offers"

type ClaimInput = {
  offerId?: string
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

  return { user, profile, error: null }
}

function resolveClientId(profile: typeof profiles.$inferSelect) {
  if (profile.role === "subuser" && profile.createdBy) {
    return profile.createdBy
  }

  return profile.id
}

function mapClaimRow(row: {
  id: string
  offerId: string
  clientId: string
  claimedAt: Date | string
  offerTitle: string
  offerBrand: string
  offerDiscount: string
  clientName: string | null
  labName: string | null
  email: string
  phone: string | null
  status: string
}): OfferClaimRecord {
  const claimedAt = row.claimedAt instanceof Date ? row.claimedAt : new Date(row.claimedAt)

  return {
    id: row.id,
    offerId: row.offerId,
    clientId: row.clientId,
    claimedAt: claimedAt.toISOString(),
    offerTitle: row.offerTitle,
    offerBrand: row.offerBrand,
    offerDiscount: row.offerDiscount,
    clientName: row.clientName?.trim() || row.email,
    labName: row.labName?.trim() || "N/A",
    email: row.email,
    phone: row.phone?.trim() || "N/A",
    status: row.status,
  }
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
    const isLabUser = isValidRoleForType("lab_portal", userContext.profile.role)

    if (!isAdmin && !isLabUser) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const baseQuery = db
      .select({
        id: offerClaims.id,
        offerId: offerClaims.offerId,
        clientId: offerClaims.clientId,
        claimedAt: offerClaims.createdAt,
        offerTitle: offers.title,
        offerBrand: offers.brand,
        offerDiscount: offers.discount,
        clientName: profiles.fullName,
        labName: profiles.labName,
        email: profiles.email,
        phone: profiles.phone,
        status: offerClaims.status,
      })
      .from(offerClaims)
      .innerJoin(offers, eq(offerClaims.offerId, offers.id))
      .innerJoin(profiles, eq(offerClaims.clientId, profiles.id))

    const rows = isAdmin
      ? await baseQuery.orderBy(desc(offerClaims.createdAt))
      : await baseQuery
          .where(eq(offerClaims.clientId, resolveClientId(userContext.profile)))
          .orderBy(desc(offerClaims.createdAt))

    return NextResponse.json({ data: rows.map(mapClaimRow) })
  } catch (error) {
    console.error("[api/offers/claims GET]", error)
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

    if (!isValidRoleForType("lab_portal", userContext.profile.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as ClaimInput
    const offerId = body.offerId?.trim() ?? ""

    if (!offerId) {
      return NextResponse.json({ error: "Offer id is required" }, { status: 400 })
    }

    const [offer] = await db.select().from(offers).where(eq(offers.id, offerId)).limit(1)
    if (!offer) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 })
    }

    const clientId = resolveClientId(userContext.profile)
    const [existing] = await db
      .select({
        id: offerClaims.id,
        offerId: offerClaims.offerId,
        clientId: offerClaims.clientId,
        claimedAt: offerClaims.createdAt,
        offerTitle: offers.title,
        offerBrand: offers.brand,
        offerDiscount: offers.discount,
        clientName: profiles.fullName,
        labName: profiles.labName,
        email: profiles.email,
        phone: profiles.phone,
        status: offerClaims.status,
      })
      .from(offerClaims)
      .innerJoin(offers, eq(offerClaims.offerId, offers.id))
      .innerJoin(profiles, eq(offerClaims.clientId, profiles.id))
      .where(and(eq(offerClaims.offerId, offerId), eq(offerClaims.clientId, clientId)))
      .limit(1)

    if (existing) {
      return NextResponse.json({ data: mapClaimRow(existing) })
    }

    const [inserted] = await db
      .insert(offerClaims)
      .values({
        offerId,
        clientId,
      })
      .returning()

    const [row] = await db
      .select({
        id: offerClaims.id,
        offerId: offerClaims.offerId,
        clientId: offerClaims.clientId,
        claimedAt: offerClaims.createdAt,
        offerTitle: offers.title,
        offerBrand: offers.brand,
        offerDiscount: offers.discount,
        clientName: profiles.fullName,
        labName: profiles.labName,
        email: profiles.email,
        phone: profiles.phone,
        status: offerClaims.status,
      })
      .from(offerClaims)
      .innerJoin(offers, eq(offerClaims.offerId, offers.id))
      .innerJoin(profiles, eq(offerClaims.clientId, profiles.id))
      .where(eq(offerClaims.id, inserted.id))
      .limit(1)

    return NextResponse.json(
      {
        data: row
          ? mapClaimRow(row)
          : mapClaimRow({
              id: inserted.id,
              offerId,
              clientId,
              claimedAt: inserted.createdAt,
              offerTitle: offer.title,
              offerBrand: offer.brand,
              offerDiscount: offer.discount,
              clientName: userContext.profile.fullName,
              labName: userContext.profile.labName,
              email: userContext.profile.email,
              phone: userContext.profile.phone,
              status: inserted.status,
            }),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("[api/offers/claims POST]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
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
      return NextResponse.json({ error: "Claim id is required" }, { status: 400 })
    }

    const body = (await req.json().catch(() => ({}))) as { status?: string }
    const status = body.status?.trim()

    if (!status) {
      return NextResponse.json({ error: "Status is required" }, { status: 400 })
    }

    const [current] = await db.select().from(offerClaims).where(eq(offerClaims.id, id)).limit(1)
    if (!current) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 })
    }

    const [updated] = await db
      .update(offerClaims)
      .set({ status })
      .where(eq(offerClaims.id, id))
      .returning()

    const [row] = await db
      .select({
        id: offerClaims.id,
        offerId: offerClaims.offerId,
        clientId: offerClaims.clientId,
        claimedAt: offerClaims.createdAt,
        offerTitle: offers.title,
        offerBrand: offers.brand,
        offerDiscount: offers.discount,
        clientName: profiles.fullName,
        labName: profiles.labName,
        email: profiles.email,
        phone: profiles.phone,
        status: offerClaims.status,
      })
      .from(offerClaims)
      .innerJoin(offers, eq(offerClaims.offerId, offers.id))
      .innerJoin(profiles, eq(offerClaims.clientId, profiles.id))
      .where(eq(offerClaims.id, updated.id))
      .limit(1)

    return NextResponse.json({ data: row ? mapClaimRow(row) : null })
  } catch (error) {
    console.error("[api/offers/claims PATCH]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
