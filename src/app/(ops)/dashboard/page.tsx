"use client"

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { fetchProfileWithCache } from "@/src/lib/profile-cache";
import { StatusBadge } from "@/src/components/StatusBadge";
import { FolderOpen, CheckCircle2, PauseCircle, XCircle, ClipboardCheck, Timer, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHART_COLORS = [
  "hsl(158,64%,28%)", "hsl(152,60%,45%)", "hsl(38,92%,50%)",
  "hsl(200,90%,45%)", "#6366f1", "#f59e0b",
];

const ACTIVE_STATUSES = ["scan_received", "scan_verified", "allocated_to_designer", "in_progress", "internal_qc"];

export default function Dashboard() {
  const router = useRouter();

  // One request per dashboard section (each renders as its own data arrives). KPIs go first; the lower
  // sections start once they settle so the first paint isn't competing with five queries at once.
  const getSection = <T,>(url: string) => async (): Promise<T> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}`);
    return res.json();
  };
  const sectionOpts = { refetchInterval: 60_000, staleTime: 50_000 };

  const kpisQuery = useQuery<{ active: number; delivered: number; pending: number; hold: number; cancelled: number }>({
    queryKey: ["ops-dashboard-kpis"],
    queryFn: getSection("/api/cases/dashboard/kpis"),
    ...sectionOpts,
  });
  const lowerEnabled = !kpisQuery.isPending;

  const { data: profile } = useQuery<{ fullName: string | null; role: string | null; labName: string | null }>({
    queryKey: ["my-profile"],
    queryFn: fetchProfileWithCache as any,
  });

  const { data: volumeData } = useQuery<{ month: string; cases: number }[]>({
    queryKey: ["ops-dashboard-volume"],
    queryFn: getSection("/api/cases/dashboard/volume"),
    enabled: lowerEnabled,
    ...sectionOpts,
  });
  const { data: breakdownData } = useQuery<{ name: string; value: number }[]>({
    queryKey: ["ops-dashboard-breakdown"],
    queryFn: getSection("/api/cases/dashboard/breakdown"),
    enabled: lowerEnabled,
    ...sectionOpts,
  });
  const { data: recentData } = useQuery<{ id: string; restoration: string; status: string; caseType: string }[]>({
    queryKey: ["ops-dashboard-recent"],
    queryFn: getSection("/api/cases/dashboard/recent"),
    enabled: lowerEnabled,
    ...sectionOpts,
  });
  const { data: tatData } = useQuery<{ avgTatDays: number | null }>({
    queryKey: ["dashboard-tat"],
    queryFn: getSection("/api/cases/tat"),
    enabled: lowerEnabled,
    ...sectionOpts,
  });

  const kpis = kpisQuery.data;
  const dynamicKpis = [
    { label: "Active / In Progress", value: kpis?.active ?? 0, icon: FolderOpen, color: "text-primary", bg: "bg-primary/10" },
    { label: "Delivered", value: kpis?.delivered ?? 0, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100" },
    { label: "Pending Approval", value: kpis?.pending ?? 0, icon: ClipboardCheck, color: "text-yellow-600", bg: "bg-yellow-100" },
    { label: "On Hold", value: kpis?.hold ?? 0, icon: PauseCircle, color: "text-red-600", bg: "bg-red-100", isHoldAlert: (kpis?.hold ?? 0) > 0 },
    { label: "Cancelled", value: kpis?.cancelled ?? 0, icon: XCircle, color: "text-gray-600", bg: "bg-gray-100" },
  ];

  const monthlyVolume = volumeData ?? [];
  const holdCount = kpis?.hold ?? 0;
  const breakdown = (breakdownData ?? []).map((d, i) => ({ ...d, color: CHART_COLORS[i % CHART_COLORS.length] }));
  const recentCases = recentData ?? [];

  const avgTat = tatData?.avgTatDays !== null && tatData?.avgTatDays !== undefined
    ? tatData.avgTatDays.toFixed(1)
    : null;

  const OPS_ROLES = ["qc", "designer", "account_manager", "consultant"];
  const greetingName = !profile
    ? null
    : OPS_ROLES.includes(profile.role ?? "")
      ? "Iconic Connect"
      : profile.fullName;
  const greeting = greetingName ? `Welcome back, ${greetingName}` : "Welcome back";

  return (
    
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{greeting}</h1>
          <p className="text-muted-foreground text-xs mt-1">Here's how the design pipeline is doing today</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {dynamicKpis.map((kpi) => (
            <Card
              key={kpi.label}
              className={`shadow-card hover:shadow-elevated transition-shadow cursor-pointer ${(kpi as any).isHoldAlert
                ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.35)] animate-pulse ring-1 ring-red-500/30 bg-red-500/5"
                : ""
                }`}
              onClick={() => router.push("/cases")}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                    <p className="text-3xl font-semibold text-foreground mt-1">{kpi.value}</p>
                  </div>
                  <div className={`p-2.5 rounded-xl ${kpi.bg} ${kpi.color}`}>
                    <kpi.icon className="h-4 w-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Monthly Case Volume</CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyVolume.every((m) => m.cases === 0) ? (
                <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">No case data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={monthlyVolume}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,90%)" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(150,18%,90%)" }} />
                    <Bar dataKey="cases" fill="hsl(158,64%,28%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Case Breakdown by Type</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              {breakdown.length === 0 ? (
                <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={breakdown} cx="50%" cy="50%" innerRadius={42} outerRadius={72} dataKey="value" paddingAngle={2}>
                        {breakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `${v}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-2 w-full">
                    {breakdown.map((d) => (
                      <div key={d.name} className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-muted-foreground truncate">{d.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* TAT / Hold alert + Recent cases */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {holdCount > 0 ? (
            <Card className="shadow-card border-red-500 bg-red-50/5 relative overflow-hidden animate-blink">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2 text-red-600">
                  <PauseCircle className="h-4 w-4 shrink-0 text-red-500" /> Cases On Hold
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[188px] flex flex-col justify-center items-center text-center p-4">
                <div className="bg-red-500/10 text-red-600 rounded-full p-4 mb-2">
                  <PauseCircle className="h-10 w-10 shrink-0" />
                </div>
                <p className="text-5xl font-bold text-red-600">{holdCount}</p>
                <p className="text-xs font-medium text-red-500 mt-2">Immediate Attention Required</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Timer className="h-4 w-4 text-primary" /> Average Turnaround
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[188px] flex flex-col justify-center">
                {avgTat ? (
                  <div className="flex items-end gap-2">
                    <p className="text-4xl font-semibold text-foreground">{avgTat}</p>
                    <p className="text-sm text-muted-foreground pb-1.5">days avg</p>
                    <span className="ml-auto text-xs text-green-600 flex items-center gap-1 pb-1.5">
                      <TrendingUp className="h-3 w-3" /> from completed cases (30d)
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No completed cases in last 30 days</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="lg:col-span-2 shadow-card">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium">Recent Cases</CardTitle>
              <button className="text-xs text-primary hover:underline" onClick={() => router.push("/cases")}>View all</button>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentCases.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No cases yet</p>
              ) : (
                recentCases.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded"
                    onClick={() => router.push("/cases")}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{c.id} · {c.restoration}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.caseType}</p>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    
  );
}
