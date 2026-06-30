import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { invoices } from "@/src/db/schema/invoice";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, desc, gte, lte, and } from "drizzle-orm";
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
    const { fromDate, toDate } = getAnalyticsDateRange(from, to);

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        startDate: invoices.startDate,
        endDate: invoices.endDate,
        caseIds: invoices.caseIds,
        total: invoices.total,
        status: invoices.status,
      })
      .from(invoices)
      .where(and(gte(invoices.createdAt, fromDate), lte(invoices.createdAt, toDate)))
      .orderBy(desc(invoices.createdAt))
      .limit(5);

    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        period: `${r.startDate} – ${r.endDate}`,
        caseCount: Array.isArray(r.caseIds) ? r.caseIds.length : 0,
        amount: Number(r.total),
        status: r.status,
      }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
