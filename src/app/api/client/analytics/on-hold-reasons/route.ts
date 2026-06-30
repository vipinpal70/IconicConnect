import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, and, gte, lte, count, sql, desc } from "drizzle-orm";
import { isLabUser, resolveClientId } from "@/src/lib/auth/resolve-client-id";
import { getCachedData, setCachedData } from "@/src/lib/redis-cache";
import { getAnalyticsDateRange } from "@/src/lib/analytics-utils";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (!isLabUser(profile)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const clientId = resolveClientId(profile);

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const { fromDate, toDate } = getAnalyticsDateRange(from, to);

    const cacheKey = `analytics:client:${clientId}:on-hold-reasons:${from || "default"}:${to || "default"}`;
    const cachedData = await getCachedData<any>(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    const rows = await db
      .select({
        reason: sql<string>`COALESCE(${cases.holdReason}, 'Unspecified')`,
        count: count(),
      })
      .from(cases)
      .where(
        and(
          eq(cases.clientId, clientId),
          eq(cases.status, "on_hold"),
          gte(cases.createdAt, fromDate),
          lte(cases.createdAt, toDate)
        )
      )
      .groupBy(sql`COALESCE(${cases.holdReason}, 'Unspecified')`)
      .orderBy(desc(count()));

    const result = rows.map((r) => ({ reason: r.reason, count: Number(r.count) }));

    await setCachedData(cacheKey, result, 3600);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
