import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { invoices } from "@/src/db/schema/invoice";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, and, isNotNull, gte, lte, count, sql } from "drizzle-orm";
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

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];

    const [totalResult, holdResult, tatResult, billingResult] = await Promise.all([
      db.select({ value: count() }).from(cases),
      db.select({ value: count() }).from(cases).where(eq(cases.status, "on_hold")),
      db
        .select({ avg: sql<number>`AVG(${cases.tat})` })
        .from(cases)
        .where(and(isNotNull(cases.tat), gte(cases.deliveredTime, thirtyDaysAgo))),
      db
        .select({ total: sql<number>`COALESCE(SUM(${invoices.total}::numeric), 0)` })
        .from(invoices)
        .where(gte(invoices.startDate, firstOfMonth)),
    ]);

    const avgTatMinutes = tatResult[0]?.avg ? Number(tatResult[0].avg) : null;

    return NextResponse.json({
      totalCases: Number(totalResult[0]?.value ?? 0),
      avgTat: avgTatMinutes !== null ? `${(avgTatMinutes / 1440).toFixed(1)}d` : "N/A",
      casesOnHold: Number(holdResult[0]?.value ?? 0),
      currentMonthBilling: Number(billingResult[0]?.total ?? 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
