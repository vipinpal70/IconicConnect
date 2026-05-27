"use client";

import { ClientLayout } from "@/src/components/ClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { StatusBadge } from "@/src/components/StatusBadge";
import { cases, activityFeed } from "@/src/data/demoData";
import { FolderOpen, CheckCircle2, ClipboardCheck, Timer, TrendingUp, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from "recharts";
import { Button } from "@/src/components/ui/button";

const activeStatuses = ["Submitted", "In Validation", "In Design", "Internal QC"] as const;

const counts = {
  active: cases.filter((c) => activeStatuses.includes(c.status as any)).length,
  delivered: cases.filter((c) => c.status === "Completed").length,
  pending: cases.filter((c) => c.status === "Pending Client Approval" || c.status === "Feedback").length,
};

const kpis = [
  { label: "Active Designs", value: counts.active, icon: Inbox, color: "text-blue-500", bg: "bg-blue-500/10" },
  { label: "Delivered (Mo)", value: counts.delivered, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { label: "Awaiting Action", value: counts.pending, icon: ClipboardCheck, color: "text-amber-500", bg: "bg-amber-500/10" },
  { label: "Avg. Turnaround", value: "4.3d", icon: Timer, color: "text-indigo-500", bg: "bg-indigo-500/10" },
];

const breakdownData = [
  { name: "Crown & Bridge", value: 65, color: "hsl(var(--primary))" },
  { name: "Implants", value: 20, color: "hsl(var(--secondary))" },
  { name: "Removables", value: 15, color: "hsl(var(--accent))" },
];

const volumeData = [
  { month: "Jan", cases: 28 },
  { month: "Feb", cases: 31 },
  { month: "Mar", cases: 35 },
  { month: "Apr", cases: 42 },
  { month: "May", cases: 18 },
];

export default function ClientDashboard() {
  const router = useRouter();

  const { data: casesData } = useQuery<{ data: any[] }>({
    queryKey: ["client-dashboard-cases"],
    queryFn: async () => {
      const res = await fetch("/api/cases");
      if (!res.ok) throw new Error("Failed to fetch cases");
      return res.json();
    },
    refetchInterval: 8000,
  });

  const liveCases = casesData?.data || [];
  const activeCount = liveCases.filter((c: any) => ["scan_received", "scan_verified", "allocated_to_designer", "in_progress", "internal_qc"].includes(c.status)).length;
  const deliveredCount = liveCases.filter((c: any) => ["approved", "delivered"].includes(c.status)).length;
  const pendingCount = liveCases.filter((c: any) => ["submitted_to_client", "client_feedback"].includes(c.status)).length;
  const holdCasesCount = liveCases.filter((c: any) => c.status === "on_hold").length;

  const dynamicKpis = [
    { label: "Active Designs", value: activeCount, icon: Inbox, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Delivered (Mo)", value: deliveredCount, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Awaiting Action", value: pendingCount, icon: ClipboardCheck, color: "text-amber-500", bg: "bg-amber-500/10" },
    holdCasesCount > 0
      ? { label: "Cases On Hold", value: holdCasesCount, icon: Timer, color: "text-red-500 animate-blink", bg: "bg-red-500/10 border-red-500/30" }
      : { label: "Avg. Turnaround", value: "4.3d", icon: Timer, color: "text-indigo-500", bg: "bg-indigo-500/10" },
  ];

  const recentCases = [...cases].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 5);

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">Welcome back, PrecisionDent Lab</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">Operational performance for your design pipeline</p>
          </div>
          <Button onClick={() => router.push("/client/cases")} size="sm" className="h-8 text-xs gradient-primary border-none shadow-glow">
            Submit New Case
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {dynamicKpis.map((k) => (
            <Card
              key={k.label}
              className="shadow-card hover:shadow-glow transition-all border-border/50 cursor-pointer"
              onClick={() => router.push("/client/cases")}
            >
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-1.5">
                  <div>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{k.label}</p>
                    <p className="text-2xl font-black text-foreground mt-0.5">{k.value}</p>
                  </div>
                  <div className={`p-1.5 rounded-lg ${k.bg} ${k.color} shadow-sm shrink-0`}><k.icon className="h-3.5 w-3.5" /></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Analytics Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Case Volume Trends</CardTitle>
              <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                <TrendingUp className="h-2.5 w-2.5" /> +12% vs last month
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="h-[220px] w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} dy={5} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip cursor={{ fill: 'hsl(var(--muted)/0.4)' }} contentStyle={{ borderRadius: '8px', border: 'none', fontSize: 10, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="cases" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Design Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 flex flex-col items-center">
              <div className="h-[150px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={breakdownData} cx="50%" cy="50%" innerRadius={45} outerRadius={60} dataKey="value" paddingAngle={4} stroke="none">
                      {breakdownData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-1 gap-1.5 w-full mt-2">
                {breakdownData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-muted-foreground">{d.name}</span>
                    </div>
                    <span className="font-bold text-foreground">{d.value}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active Design Queue</CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2 text-primary" onClick={() => router.push("/client/cases")}>View All</Button>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-0.5">
              {recentCases.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/30 -mx-1 px-2 rounded transition-colors" onClick={() => router.push(`/client/cases/${c.id}`)}>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-foreground">{c.id} · {c.restoration}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{c.caseType} · Patient {c.patientRef}</p>
                  </div>
                  <div className="scale-90 origin-right">
                    <StatusBadge status={c.status} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-3 pt-1">
              {activityFeed.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-start gap-2.5">
                  <div className="w-6.5 h-6.5 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0 scale-90">
                    <TrendingUp className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground leading-tight">{a.message}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{a.time}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </ClientLayout>
  );
}