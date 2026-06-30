import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, and, isNotNull, gte, lte, sql } from "drizzle-orm";
import { isValidRoleForType } from "@/src/lib/auth/role";
import { getAnalyticsDateRange } from "@/src/lib/analytics-utils";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (!isValidRoleForType("admin_portal", profile.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const { fromDate, toDate, truncUnit, format } = getAnalyticsDateRange(from, to);

    const rows = await db
      .select({
        month: sql<string>`to_char(date_trunc(${sql.raw(`'${truncUnit}'`)}, ${cases.deliveredTime}), ${sql.raw(`'${format}'`)})`,
        tat: sql<number>`ROUND(AVG(${cases.tat}) / 1440.0, 1)`,
      })
      .from(cases)
      .where(and(
        isNotNull(cases.tat),
        isNotNull(cases.deliveredTime),
        gte(cases.deliveredTime, fromDate),
        lte(cases.deliveredTime, toDate)
      ))
      .groupBy(sql`date_trunc(${sql.raw(`'${truncUnit}'`)}, ${cases.deliveredTime})`)
      .orderBy(sql`date_trunc(${sql.raw(`'${truncUnit}'`)}, ${cases.deliveredTime})`);

    return NextResponse.json(rows.map((r) => ({ month: r.month, tat: Number(r.tat) })));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
