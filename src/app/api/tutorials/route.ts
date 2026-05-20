import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { db } from "@/src/db"
import { tutorials } from "@/src/db/schema/tutorial"
import { profiles } from "@/src/db/schema/profile"
import { createClient } from "@/src/lib/supabase/server"
import { isValidRoleForType } from "@/src/lib/auth/role"
import {
  extractYouTubeVideoId,
  isTutorialCategory,
  isYouTubeVideoId,
  TUTORIAL_CATEGORIES,
} from "@/src/lib/tutorials"

type TutorialInput = {
  title?: string
  description?: string
  category?: string
  youtubeVideoId?: string
}

async function getAdminProfile() {
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

  if (!isValidRoleForType("admin_portal", profile.role)) {
    return { user, profile, error: "Forbidden" as const }
  }

  return { user, profile, error: null as const }
}

export async function GET() {
  try {
    const items = await db.select().from(tutorials).orderBy(desc(tutorials.createdAt))
    return NextResponse.json({ data: items })
  } catch (error) {
    console.error("[api/tutorials GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await getAdminProfile()

    if (admin.error === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (admin.error === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as TutorialInput
    const title = body.title?.trim() ?? ""
    const description = body.description?.trim() ?? ""
    const category = body.category?.trim() ?? ""
    const youtubeVideoId = extractYouTubeVideoId(body.youtubeVideoId ?? "")

    if (!title) {
      return NextResponse.json({ error: "Tutorial title is required" }, { status: 400 })
    }

    if (!description) {
      return NextResponse.json({ error: "Tutorial description is required" }, { status: 400 })
    }

    if (!isTutorialCategory(category)) {
      return NextResponse.json(
        { error: `Category is required. Choose one of: ${TUTORIAL_CATEGORIES.join(", ")}` },
        { status: 400 }
      )
    }

    if (!youtubeVideoId || !isYouTubeVideoId(youtubeVideoId)) {
      return NextResponse.json({ error: "Enter a valid 11-character YouTube video ID" }, { status: 400 })
    }

    const [inserted] = await db
      .insert(tutorials)
      .values({
        title,
        category,
        description,
        youtubeVideoId,
      })
      .returning()

    return NextResponse.json({ data: inserted }, { status: 201 })
  } catch (error) {
    console.error("[api/tutorials POST]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await getAdminProfile()

    if (admin.error === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (admin.error === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Tutorial id is required" }, { status: 400 })
    }

    const deleted = await db
      .delete(tutorials)
      .where(eq(tutorials.id, id))
      .returning({ id: tutorials.id })

    if (!deleted.length) {
      return NextResponse.json({ error: "Tutorial not found" }, { status: 404 })
    }

    return NextResponse.json({ data: deleted[0] })
  } catch (error) {
    console.error("[api/tutorials DELETE]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
