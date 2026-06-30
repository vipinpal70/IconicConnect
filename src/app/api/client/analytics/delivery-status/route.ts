import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, and, count, sql, gte, lte } from "drizzle-orm";
import { isLabUser, resolveClientId } from "@/src/lib/auth/resolve-client-id";
import { getCachedData, setCachedData } from "@/src/lib/redis-cache";
import { getAnalyticsDateRange } from "@/src/lib/analytics-utils";

const STATUS_BUCKETS = [
  { name: "Completed",      statuses: ["approved", "delivered"] },
  { name: "In Progress",    statuses: ["scan_received", "scan_verified", "scan_not_verified", "allocated_to_designer", "in_progress", "internal_qc", "change_requested"] },
  { name: "Awaiting Client",statuses: ["submitted_to_client"] },
  { name: "Feedback",       statuses: ["client_feedback"] },
  { name: "On Hold",        statuses: ["on_hold"] },
  { name: "Cancelled",      statuses: ["cancelled", "client_reject"] },
] as const;

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

    const cacheKey = `analytics:client:${clientId}:delivery-status:${from || "default"}:${to || "default"}`;
    const cachedData = await getCachedData<any>(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    const rows = await db
      .select({ status: cases.status, cnt: count() })
      .from(cases)
      .where(and(eq(cases.clientId, clientId), gte(cases.createdAt, fromDate), lte(cases.createdAt, toDate)))
      .groupBy(cases.status);

    const countMap = new Map(rows.map((r) => [r.status, Number(r.cnt)]));

    const result = STATUS_BUCKETS.map(({ name, statuses }) => ({
      name,
      value: statuses.reduce((sum, s) => sum + (countMap.get(s as any) ?? 0), 0),
    })).filter((d) => d.value > 0);

    await setCachedData(cacheKey, result, 3600);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
