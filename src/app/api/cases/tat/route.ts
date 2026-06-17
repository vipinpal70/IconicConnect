import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { profiles, subUsers } from "@/src/db/schema/profile";
import { createClient } from "@/src/lib/supabase/server";
import { eq, and, gte, isNotNull, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profileResult = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const conditions = [
      isNotNull(cases.tat),
      gte(cases.deliveredTime, thirtyDaysAgo)
    ];

    if (profile.role === "client" || profile.role === "subuser") {
      let clientId: string | null = null;
      if (profile.role === "client") {
        clientId = profile.id;
      } else {
        clientId = profile.createdBy;
        if (!clientId) {
          const subUserRecord = await db
            .select()
            .from(subUsers)
            .where(eq(subUsers.id, profile.id))
            .limit(1);
          if (subUserRecord.length > 0) {
            clientId = subUserRecord[0].clientId;
          }
        }
      }

      if (!clientId) {
        return NextResponse.json({ error: "Client ID not found" }, { status: 400 });
      }
      conditions.push(eq(cases.clientId, clientId));
    }

    const result = await db
      .select({
        avgTat: sql<number>`AVG(${cases.tat})`
      })
      .from(cases)
      .where(and(...conditions));

    const avgTatMinutes = result[0]?.avgTat ? Number(result[0].avgTat) : null;
    const avgTatDays = avgTatMinutes !== null ? avgTatMinutes / 1440 : null;
    const avgTatHours = avgTatMinutes !== null ? avgTatMinutes / 60 : null;

    return NextResponse.json({
      avgTatMinutes,
      avgTatDays,
      avgTatHours,
    });
  } catch (error: unknown) {
    console.error("TAT fetch error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
