import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { invoices } from "@/src/db/schema/invoice";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, and, isNotNull, gte, lte, count, sql } from "drizzle-orm";
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

    const cacheKey = `analytics:client:${clientId}:kpis:${from || "default"}:${to || "default"}`;
    const cachedData = await getCachedData<any>(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    const fromDateStr = fromDate.toISOString().split("T")[0];
    const toDateStr = toDate.toISOString().split("T")[0];

    const [totalResult, holdResult, tatResult, billingResult] = await Promise.all([
      db.select({ value: count() }).from(cases).where(and(eq(cases.clientId, clientId), gte(cases.createdAt, fromDate), lte(cases.createdAt, toDate))),
      db
        .select({ value: count() })
        .from(cases)
        .where(and(eq(cases.clientId, clientId), eq(cases.status, "on_hold"), gte(cases.createdAt, fromDate), lte(cases.createdAt, toDate))),
      db
        .select({ avg: sql<number>`AVG(${cases.tat})` })
        .from(cases)
        .where(
          and(
            eq(cases.clientId, clientId),
            isNotNull(cases.tat),
            gte(cases.deliveredTime, fromDate),
            lte(cases.deliveredTime, toDate)
          )
        ),
      db
        .select({ total: sql<number>`COALESCE(SUM(${invoices.total}::numeric), 0)` })
        .from(invoices)
        .where(and(eq(invoices.clientId, clientId), gte(invoices.startDate, fromDateStr), lte(invoices.startDate, toDateStr))),
    ]);

    const avgTatMinutes = tatResult[0]?.avg ? Number(tatResult[0].avg) : null;

    const result = {
      totalCases: Number(totalResult[0]?.value ?? 0),
      avgTat: avgTatMinutes !== null ? `${(avgTatMinutes / 1440).toFixed(1)}d` : "N/A",
      casesOnHold: Number(holdResult[0]?.value ?? 0),
      currentMonthBilling: Number(billingResult[0]?.total ?? 0),
    };

    await setCachedData(cacheKey, result, 3600);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
