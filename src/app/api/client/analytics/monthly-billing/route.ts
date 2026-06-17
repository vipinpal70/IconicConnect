import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { invoices } from "@/src/db/schema/invoice";
import { profiles } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, and, gte, sql } from "drizzle-orm";
import { isLabUser, resolveClientId } from "@/src/lib/auth/resolve-client-id";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (!isLabUser(profile)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const clientId = resolveClientId(profile);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    const cutoff = sixMonthsAgo.toISOString().split("T")[0];

    const rows = await db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${invoices.startDate}::date), 'Mon')`,
        amount: sql<number>`ROUND(SUM(${invoices.total}::numeric), 2)`,
      })
      .from(invoices)
      .where(and(eq(invoices.clientId, clientId), gte(invoices.startDate, cutoff)))
      .groupBy(sql`date_trunc('month', ${invoices.startDate}::date)`)
      .orderBy(sql`date_trunc('month', ${invoices.startDate}::date)`);

    return NextResponse.json(rows.map((r) => ({ month: r.month, amount: Number(r.amount) })));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
