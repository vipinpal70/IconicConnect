import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, count, sql, gte, lte, and } from "drizzle-orm";
import { isValidRoleForType } from "@/src/lib/auth/role";
import { getAnalyticsDateRange } from "@/src/lib/analytics-utils";

const IN_PROGRESS_STATUSES = new Set(["scan_received", "scan_verified", "scan_not_verified", "allocated_to_designer", "in_progress", "internal_qc", "change_requested"]);

function bucketFor(status: string): string {
  if (status === "delivered" || status === "approved") return "Completed";
  if (status === "submitted_to_client") return "Awaiting Client";
  if (status === "client_feedback") return "Feedback";
  if (status === "on_hold") return "On Hold";
  if (["cancelled", "client_reject"].includes(status)) return "Cancelled";
  if (IN_PROGRESS_STATUSES.has(status)) return "In Progress";
  return "Other";
}

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
      .select({ status: cases.status, cnt: count() })
      .from(cases)
      .where(and(gte(cases.createdAt, fromDate), lte(cases.createdAt, toDate)))
      .groupBy(cases.status);

    const bucketCounts = new Map<string, number>();
    for (const row of rows) {
      const bucket = bucketFor(row.status);
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + Number(row.cnt));
    }

    const result = Array.from(bucketCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
