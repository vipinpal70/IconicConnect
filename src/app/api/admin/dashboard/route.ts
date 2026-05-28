import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { profiles } from "@/src/db/schema/profile";
import { activityLogs } from "@/src/db/schema/activity-log";
import { createClient } from "@/src/lib/supabase/server";
import { eq, inArray, notInArray, and, count, desc, isNotNull } from "drizzle-orm";
import { isValidRoleForType } from "@/src/lib/auth/role";

import { formatActivityLabel } from "@/src/lib/activity-log";

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

    if (!isValidRoleForType("admin_portal", profile.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 1. Fetch KPI Counts
    const [
      incomingResult,
      inDesignResult,
      internalQcResult,
      awaitApprovalResult,
      holdResult,
      activeClientsResult
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(cases)
        .where(inArray(cases.status, ["scan_received", "scan_verified", "scan_not_verified"])),
      db
        .select({ value: count() })
        .from(cases)
        .where(inArray(cases.status, ["allocated_to_designer", "in_progress", "client_feedback"])),
      db
        .select({ value: count() })
        .from(cases)
        .where(eq(cases.status, "internal_qc")),
      db
        .select({ value: count() })
        .from(cases)
        .where(eq(cases.status, "submitted_to_client")),
      db
        .select({ value: count() })
        .from(cases)
        .where(eq(cases.status, "on_hold")),
      db
        .select({ value: count() })
        .from(profiles)
        .where(eq(profiles.role, "client"))
    ]);

    const counts = {
      incoming: incomingResult[0]?.value || 0,
      inDesign: inDesignResult[0]?.value || 0,
      internalQc: internalQcResult[0]?.value || 0,
      awaitClientApproval: awaitApprovalResult[0]?.value || 0,
      holdCase: holdResult[0]?.value || 0,
      activeClients: activeClientsResult[0]?.value || 0,
    };

    // 2. Fetch Recent Cases (with Client and Designer information)
    const recentCasesResult = await db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        category: cases.category,
        subTypeData: cases.subTypeData,
        status: cases.status,
        updatedAt: cases.updatedAt,
        designerId: cases.designerId,
        clientLabName: profiles.labName,
        clientFullName: profiles.fullName,
      })
      .from(cases)
      .leftJoin(profiles, eq(cases.clientId, profiles.id))
      .orderBy(desc(cases.updatedAt))
      .limit(10);

    const designerIds = Array.from(new Set(recentCasesResult.map((c) => c.designerId).filter(Boolean))) as string[];
    const designersMap = new Map<string, string>();
    if (designerIds.length > 0) {
      const designersProfiles = await db
        .select()
        .from(profiles)
        .where(inArray(profiles.id, designerIds));
      designersProfiles.forEach((p) => {
        designersMap.set(p.id, p.fullName || p.email.split("@")[0]);
      });
    }

    const recentCases = recentCasesResult.map((c) => {
      // Extract details from subTypeData
      let restoration = "";
      const data = (c.subTypeData as Record<string, any>) || {};
      
      if (c.category === "Crown & Bridges" || c.category === "Crown & Bridge") {
        restoration = data.caseType || "Zirconia Crown";
      } else if (c.category === "Denture") {
        restoration = data.caseType1 ? `${data.caseType1} (${data.caseType2 || ""})` : "Denture";
      } else if (c.category === "Appliances") {
        restoration = data.caseType1 || "Night Guard";
      } else if (c.category === "Implant") {
        restoration = data.caseType1 ? `${data.caseType1} (${data.caseType2 || ""})` : "Implant";
      } else {
        restoration = data.caseType || data.caseType1 || "Custom Restoration";
      }

      const clientLabel = c.clientLabName || c.clientFullName || "Client";
      const designerLabel = c.designerId ? (designersMap.get(c.designerId) || "unallocated") : "unallocated";

      return {
        id: c.id,
        caseNumber: c.caseNumber,
        clientName: clientLabel,
        category: c.category || "General",
        restoration,
        designer: designerLabel,
        status: c.status,
      };
    });

    // 3. Fetch Designer Workload (Include all designers and count their active cases)
    const designerLoadResult = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        email: profiles.email,
        load: count(cases.id)
      })
      .from(profiles)
      .leftJoin(
        cases,
        and(
          eq(cases.designerId, profiles.id),
          notInArray(cases.status, ["approved", "delivered"])
        )
      )
      .where(eq(profiles.role, "designer"))
      .groupBy(profiles.id, profiles.fullName, profiles.email)
      .orderBy(desc(count(cases.id)));

    return NextResponse.json({
      counts,
      recentActivities: recentCases,
      designerLoad: designerLoadResult.map((d) => ({
        name: d.fullName || d.email.split("@")[0],
        load: Number(d.load),
      })),
    });
  } catch (error: unknown) {
    console.error("Admin dashboard fetch error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
