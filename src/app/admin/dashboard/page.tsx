"use client";

import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Inbox, Layers, ShieldCheck, ClipboardCheck, Users, MapPin, Building2, CalendarDays, Timer } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { StatusBadge } from "@/src/components/StatusBadge";

const CHART_MARGIN = { left: 5, right: 12, top: 0, bottom: 0 } as const;

export default function AdminDashboard() {
  const router = useRouter();

  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ["admin-dashboard-data"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const counts = dashboardData?.counts || {
    incoming: 0,
    inDesign: 0,
    internalQc: 0,
    awaitClientApproval: 0,
    holdCase: 0,
    activeClients: 0,
    avgTat: "N/A",
  };

  const designerLoad = dashboardData?.designerLoad || [];
  const recentActivities = dashboardData?.recentActivities || [];
  const recentClients = dashboardData?.recentClients || [];

  const kpis = [
    { label: "incoming/in_validation", value: counts.incoming, icon: Inbox, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "in_design", value: counts.inDesign, icon: Layers, color: "text-primary", bg: "bg-primary/10" },
    { label: "internal_qc", value: counts.internalQc, icon: ShieldCheck, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "await_client_approval", value: counts.awaitClientApproval, icon: ClipboardCheck, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { 
      label: "hold Case", 
      value: counts.holdCase, 
      icon: Users, 
      color: "text-red-500", 
      bg: "bg-red-500/10",
      isHoldAlert: counts.holdCase > 0
    },
    {
      label: "avg_turnaround_(30d)",
      value: counts.avgTat || "N/A",
      icon: Timer,
      color: "text-purple-500",
      bg: "bg-purple-500/10"
    }
  ];

  return (
    <AdminLayout>
      <div className="space-y-4 animate-fade-in text-xs">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold text-foreground">Iconic Connect — Admin</h1>
          <p className="text-xs text-muted-foreground">Operational overview across all client labs</p>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k) => (
            <Card
              key={k.label}
              className={`shadow-card hover:shadow-glow transition-all cursor-pointer border-border/50 ${
                k.isHoldAlert ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.35)] animate-pulse ring-1 ring-red-500/30 bg-red-500/5" : ""
              }`}
              onClick={() => router.push("/admin/cases")}
            >
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
                      {k.label.replace("_", " ").replace("/", " / ")}
                    </p>
                    <p className="text-2xl font-semibold text-foreground mt-0.5">
                      {isLoading ? "..." : k.value}
                    </p>
                  </div>
                  <div className={`p-2 rounded-lg shrink-0 ${k.bg} ${k.color} shadow-sm`}>
                    <k.icon className="h-3.5 w-3.5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Recent Activity Log */}
          <Card className="lg:col-span-2 shadow-card border-border/50 flex flex-col">
            <CardHeader className="p-3.5 pb-2 border-b border-border/60 flex flex-row items-center justify-between space-y-0 shrink-0">
              <CardTitle className="text-xs font-semibold">Recent Case Activity</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] text-primary px-2"
                onClick={() => router.push("/admin/cases")}
              >
                View All Cases
              </Button>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-y-auto max-h-[300px] pr-1 scrollbar-thin">
              {isLoading ? (
                <div className="flex items-center justify-center p-8 text-muted-foreground text-[11px]">
                  Loading recent cases...
                </div>
              ) : recentActivities.length === 0 ? (
                <div className="flex items-center justify-center p-8 text-muted-foreground text-[11px]">
                  No recent cases found.
                </div>
              ) : (
                recentActivities.map((act: any) => (
                  <div
                    key={act.id}
                    className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => router.push(`/admin/cases/${act.id}`)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-foreground leading-tight">
                        {act.caseNumber} · {act.clientName}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {act.category} · {act.restoration} · designer {act.designer}
                      </p>
                    </div>
                    <div className="scale-90 origin-right shrink-0 ml-3">
                      <StatusBadge status={act.status} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Designer Workload */}
          <Card className="shadow-card border-border/50">
            <CardHeader className="p-3.5 pb-2 border-b border-border/60 space-y-0">
              <CardTitle className="text-xs font-semibold">Designer Workload</CardTitle>
            </CardHeader>
            <CardContent className="p-3.5 pt-3">
              {isLoading ? (
                <div className="flex items-center justify-center h-[190px] text-muted-foreground text-[11px]">
                  Loading designer loads...
                </div>
              ) : designerLoad.length === 0 ? (
                <div className="flex items-center justify-center h-[190px] text-muted-foreground text-[11px]">
                  No designers registered.
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[190px] pr-1 scrollbar-thin">
                  <ResponsiveContainer width="100%" height={Math.max(190, designerLoad.length * 32)}>
                    <BarChart data={designerLoad} layout="vertical" margin={CHART_MARGIN}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        stroke="none"
                        width={80}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: "8px",
                          border: "none",
                          boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                          fontSize: "11px",
                        }}
                      />
                      <Bar dataKey="load" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recently Added Clients */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="p-3.5 pb-2 border-b border-border/60 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold text-foreground">Active Clients Overview</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] text-primary px-2"
              onClick={() => router.push("/admin/clients")}
            >
              Manage Clients
            </Button>
          </CardHeader>
          <CardContent className="p-3.5">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-border/50 p-3 space-y-2 animate-pulse">
                    <div className="h-3 bg-muted rounded w-3/4" />
                    <div className="h-2.5 bg-muted rounded w-1/2" />
                    <div className="h-px bg-border/50 mt-2" />
                    <div className="flex justify-between">
                      <div className="h-2.5 bg-muted rounded w-1/3" />
                      <div className="h-2.5 bg-muted rounded w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentClients.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-[11px]">
                No clients registered yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentClients.map((c: any) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-border/50 p-3 hover:shadow-glow hover:border-primary/30 transition-all cursor-pointer bg-card/50 group"
                    onClick={() => router.push(`/admin/clients/${c.id}`)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="p-1.5 rounded-md bg-primary/10 shrink-0 mt-0.5">
                        <Building2 className="h-3 w-3 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                          {c.name}
                        </p>
                        {c.location ? (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{c.location}</span>
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground mt-0.5">No location set</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 h-4 font-semibold border-0 ${
                            c.status === "active"
                              ? "bg-green-100 text-green-700"
                              : c.status === "pending"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {c.status === "active" ? "Approved" : c.status === "pending" ? "Pending" : c.status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 h-4 font-semibold border-0 ${
                            c.plan === "Trial"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {c.plan || "Trial"}
                        </Badge>
                      </div>
                      <p className="text-[9px] text-muted-foreground flex items-center gap-1 shrink-0">
                        <CalendarDays className="h-2.5 w-2.5" />
                        {c.onBoardedAt
                          ? new Date(c.onBoardedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })
                          : new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })
                        }
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
