import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, count, sql, desc } from "drizzle-orm";
import { isValidRoleForType } from "@/src/lib/auth/role";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (!isValidRoleForType("admin_portal", profile.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rows = await db
      .select({
        name: sql<string>`COALESCE(${cases.category}, 'Other')`,
        value: count(),
      })
      .from(cases)
      .groupBy(sql`COALESCE(${cases.category}, 'Other')`)
      .orderBy(desc(count()));

    return NextResponse.json(rows.map((r) => ({ name: r.name, value: Number(r.value) })));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
