"use client";

import { ClientLayout } from "@/src/components/ClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { StatusBadge } from "@/src/components/StatusBadge";
import { CheckCircle2, ClipboardCheck, Timer, TrendingUp, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";
import { Button } from "@/src/components/ui/button";

export default function ClientDashboard() {
  const router = useRouter();

  const { data: profile } = useQuery<{ fullName: string | null; labName: string | null }>({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ["client-dashboard-data"],
    queryFn: async () => {
      const res = await fetch("/api/client/dashboard");
      if (!res.ok) throw new Error("Failed to fetch client dashboard data");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const counts = dashboardData?.counts || {
    active: 0,
    delivered: 0,
    awaitingAction: 0,
    holdCount: 0,
    avgTurnaround: "0.0d",
  };

  const volumeTrends = dashboardData?.volumeTrends || [];
  const breakdownData = dashboardData?.breakdownData || [];
  const activeDesignQueue = dashboardData?.activeDesignQueue || [];
  const activityTimeline = dashboardData?.activityTimeline || [];

  const dynamicKpis = [
    { label: "Active Designs", value: counts.active, icon: Inbox, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Delivered", value: counts.delivered, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Awaiting Action", value: counts.awaitingAction, icon: ClipboardCheck, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "Avg. Turnaround", value: counts.avgTurnaround, icon: Timer, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    {
      label: "Hold Cases",
      value: counts.holdCount,
      icon: Timer,
      color: "text-red-500",
      bg: "bg-red-500/10",
      isHoldAlert: counts.holdCount > 0
    },
  ];

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in text-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              Welcome back, {profile?.labName || profile?.fullName || "Iconic Connect"}
            </h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">Operational performance for your design pipeline</p>
          </div>
          <Button onClick={() => router.push("/client/cases")} size="sm" className="h-8 text-xs gradient-primary border-none shadow-glow">
            Submit New Case
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {dynamicKpis.map((k) => (
            <Card
              key={k.label}
              className={`shadow-card hover:shadow-glow transition-all border-border/50 cursor-pointer ${k.isHoldAlert ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.35)] animate-pulse ring-1 ring-red-500/30 bg-red-500/5" : ""
                }`}
              onClick={() => router.push("/client/cases")}
            >
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-1.5">
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">{k.label}</p>
                    <p className="text-2xl font-semibold text-foreground mt-0.5">
                      {isLoading ? "..." : k.value}
                    </p>
                  </div>
                  <div className={`p-1.5 rounded-lg ${k.bg} ${k.color} shadow-sm shrink-0`}>
                    <k.icon className="h-3.5 w-3.5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Analytics Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Monthly volume trends */}
          <Card className="lg:col-span-2 shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Case Volume Trends (Monthly)</CardTitle>
              <div className="flex items-center gap-1 text-[9px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                <TrendingUp className="h-2.5 w-2.5" /> Live Trend Tracking
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="h-[220px] w-full pt-2">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">Loading trend chart...</div>
                ) : volumeTrends.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">No case volume data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={volumeTrends}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} dy={5} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip cursor={{ fill: 'hsl(var(--muted)/0.4)' }} contentStyle={{ borderRadius: '8px', border: 'none', fontSize: 10, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Bar dataKey="cases" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Design Breakdown pie chart */}
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Design Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 flex flex-col items-center">
              <div className="h-[150px] w-full">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">Loading breakdown...</div>
                ) : breakdownData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">No data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={breakdownData} cx="50%" cy="50%" innerRadius={45} outerRadius={60} dataKey="value" paddingAngle={4} stroke="none">
                        {breakdownData.map((entry: any, index: number) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="grid grid-cols-1 gap-1.5 w-full mt-2 overflow-y-auto max-h-[100px]">
                {breakdownData.map((d: any) => (
                  <div key={d.name} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-muted-foreground">{d.name}</span>
                    </div>
                    <span className="font-semibold text-foreground">{d.value}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Active Design Queue */}
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Active Design Queue</CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2 text-primary" onClick={() => router.push("/client/cases")}>View All</Button>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-0.5 overflow-y-auto max-h-[300px] pr-1 scrollbar-thin">
              {isLoading ? (
                <div className="flex items-center justify-center p-8 text-muted-foreground">Loading active queue...</div>
              ) : activeDesignQueue.length === 0 ? (
                <div className="flex items-center justify-center p-8 text-muted-foreground">No active designs in pipeline</div>
              ) : (
                activeDesignQueue.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/30 -mx-1 px-2 rounded transition-colors" onClick={() => router.push(`/client/cases/${c.id}`)}>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">{c.caseNumber} · {c.restoration}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{c.category}</p>
                    </div>
                    <div className="scale-90 origin-right shrink-0 ml-3">
                      <StatusBadge status={c.status} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Activity Timeline */}
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-3 pt-1 overflow-y-auto max-h-[300px] pr-1 scrollbar-thin">
              {isLoading ? (
                <div className="flex items-center justify-center p-8 text-muted-foreground">Loading timeline...</div>
              ) : activityTimeline.length === 0 ? (
                <div className="flex items-center justify-center p-8 text-muted-foreground">No activity recorded yet</div>
              ) : (
                activityTimeline.map((a: any) => (
                  <div key={a.id} className="flex items-start gap-2.5">
                    <div className="w-6.5 h-6.5 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0 scale-90">
                      <TrendingUp className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground leading-tight">{a.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{a.time}</p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ClientLayout>
  );
}