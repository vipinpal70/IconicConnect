import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { cases } from "@/src/db/schema/case";
import { profiles } from "@/src/db/schema/profile";
import { activityLogs } from "@/src/db/schema/activity-log";
import { createClient } from "@/src/lib/supabase/server";
import { eq, inArray, desc, and, isNotNull, gte, sql } from "drizzle-orm";
import { formatActivityLabel } from "@/src/lib/activity-log";
import { getCachedData, setCachedData } from "@/src/lib/redis-cache";

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

    let clientId: string | undefined;

    if (profile.role === "client") {
      clientId = profile.id;
    } else if (profile.role === "subuser") {
      if (!profile.createdBy) {
        return NextResponse.json({ error: "Subuser parent client not found" }, { status: 400 });
      }
      clientId = profile.createdBy;
    } else {
      return NextResponse.json({ error: "Unauthorized role for client dashboard" }, { status: 403 });
    }

    const cacheKey = `dashboard:client:${clientId}`;
    const cachedData = await getCachedData<any>(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    // Fetch all cases for this client
    let clientCases = await db
      .select()
      .from(cases)
      .where(eq(cases.clientId, clientId))
      .orderBy(desc(cases.updatedAt));

    // 1. KPI Counts
    // Active design: status in validation, in design, internal qc, client feedback, scan received, etc.
    const activeStatuses = [
      "scan_received",
      "scan_verified",
      "scan_not_verified",
      "allocated_to_designer",
      "in_progress",
      "internal_qc",
      "client_feedback"
    ];
    
    const activeCount = clientCases.filter((c) => activeStatuses.includes(c.status)).length;
    const deliveredCount = clientCases.filter((c) => ["approved", "delivered"].includes(c.status)).length;
    const awaitingActionCount = clientCases.filter((c) => c.status === "submitted_to_client").length;
    const holdCount = clientCases.filter((c) => c.status === "on_hold").length;

    // Avg Turnaround Time Calculation using DB tat column for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const tatResult = await db
      .select({
        avgTat: sql<number>`AVG(${cases.tat})`
      })
      .from(cases)
      .where(
        and(
          eq(cases.clientId, clientId),
          isNotNull(cases.tat),
          gte(cases.deliveredTime, thirtyDaysAgo)
        )
      );
    const avgTatMinutes = tatResult[0]?.avgTat ? Number(tatResult[0].avgTat) : null;
    const avgTurnaround = avgTatMinutes !== null ? `${(avgTatMinutes / 1440).toFixed(1)}d` : "4.5d";

    // 2. Case Volume Trends (Monthly)
    const now = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(now.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const recentCases = clientCases.filter((c) => new Date(c.createdAt) >= sixMonthsAgo);
    const volumeTrendsMap = new Map<string, number>();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setMonth(now.getMonth() - 5 + i);
      const label = `${monthNames[d.getMonth()]}`;
      volumeTrendsMap.set(label, 0);
    }

    recentCases.forEach((c) => {
      const date = new Date(c.createdAt);
      const label = `${monthNames[date.getMonth()]}`;
      if (volumeTrendsMap.has(label)) {
        volumeTrendsMap.set(label, volumeTrendsMap.get(label)! + 1);
      }
    });

    const volumeTrends = Array.from(volumeTrendsMap.entries()).map(([month, count]) => ({
      month,
      cases: count,
    }));

    // 3. Design Breakdown (Category-wise)
    const categoryCounts: Record<string, number> = {};
    clientCases.forEach((c) => {
      const cat = c.category || "Other";
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const totalClientCasesCount = clientCases.length;
    const colors = ["hsl(158,64%,28%)", "hsl(38,92%,50%)", "hsl(200,90%,45%)", "#6366f1", "#f59e0b", "#10b981"];
    const breakdownData = Object.entries(categoryCounts)
      .map(([name, count], index) => ({
        name,
        value: totalClientCasesCount > 0 ? Math.round((count / totalClientCasesCount) * 100) : 0,
        color: colors[index % colors.length],
      }))
      .sort((a, b) => b.value - a.value);

    // 4. Active Design Queue (Top 10 active cases)
    const activeDesignQueue = clientCases
      .filter((c) => !["approved", "delivered"].includes(c.status))
      .slice(0, 10)
      .map((c) => {
        const data = (c.subTypeData as Record<string, any>) || {};
        let restoration = "";
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

        const patient = data.patientName || data.patientId || `Patient PR-${c.caseNumber?.split("-")[1] || "8821"}`;

        return {
          id: c.id,
          caseNumber: c.caseNumber,
          category: c.category || "General",
          restoration,
          patient,
          status: c.status,
          dueDate: c.dueDate,
          updatedAt: c.updatedAt,
        };
      });

    function getRelativeTime(dateString: string | Date): string {
      const now = new Date();
      const date = new Date(dateString);
      const diffMs = now.getTime() - date.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSecs < 60) return "Just now";
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
      if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
      
      const diffMonths = Math.floor(diffDays / 30);
      return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
    }

    // 5. Activity Timeline for this Client's Cases
    const caseIds = clientCases.map((c) => c.id);
    let activityTimeline: any[] = [];
    if (caseIds.length > 0) {
      const logs = await db
        .select({
          id: activityLogs.id,
          caseId: activityLogs.caseId,
          userId: activityLogs.userId,
          userType: activityLogs.userType,
          userRole: activityLogs.userRole,
          action: activityLogs.action,
          details: activityLogs.details,
          actionAt: activityLogs.actionAt,
          caseNumber: cases.caseNumber,
          category: cases.category,
          actorName: profiles.fullName,
        })
        .from(activityLogs)
        .leftJoin(cases, eq(activityLogs.caseId, cases.id))
        .leftJoin(profiles, eq(activityLogs.userId, profiles.id))
        .where(inArray(activityLogs.caseId, caseIds))
        .orderBy(desc(activityLogs.actionAt))
        .limit(10);

      activityTimeline = logs.map((log) => {
        let msg = "";
        const detailsObj = (typeof log.details === "object" ? log.details : null) as any;
        
        if (log.action === "case.created") {
          msg = `New case ${log.caseNumber} submitted`;
        } else if (log.action === "case.updated") {
          const status = detailsObj?.changes?.status || detailsObj?.status;
          if (status === "internal_qc") {
            msg = `Case ${log.caseNumber} moved to Internal QC`;
          } else if (status === "client_feedback") {
            msg = `New feedback received for ${log.caseNumber}`;
          } else if (status === "scan_received") {
            msg = `New case ${log.caseNumber} submitted`;
          } else {
            msg = `Case ${log.caseNumber} updated to ${status?.replace("_", " ")}`;
          }
        } else if (log.action === "invoice.paid") {
          const invNum = detailsObj?.changes?.invoiceNumber || detailsObj?.invoiceNumber || "INV-2024-05";
          msg = `Invoice ${invNum} paid successfully`;
        } else {
          msg = formatActivityLabel(log.action, detailsObj) || log.action;
          if (log.caseNumber) {
            msg += ` for case ${log.caseNumber}`;
          }
        }

        return {
          id: log.id,
          message: msg,
          time: getRelativeTime(log.actionAt),
        };
      });
    }

    const dashboardResponse = {
      counts: {
        active: activeCount,
        delivered: deliveredCount,
        awaitingAction: awaitingActionCount,
        holdCount,
        avgTurnaround,
      },
      volumeTrends,
      breakdownData,
      activeDesignQueue,
      activityTimeline,
    };

    await setCachedData(cacheKey, dashboardResponse, 300);

    return NextResponse.json(dashboardResponse);
  } catch (error: unknown) {
    console.error("Client dashboard fetch error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
