"use client"

import { OpsLayout } from "@/src/components/OpsLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { StatusBadge } from "@/src/components/StatusBadge";
import { FolderOpen, CheckCircle2, PauseCircle, XCircle, ClipboardCheck, Timer, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

// Mock data for UI only
const kpis = [
  { label: "Active / In Progress", value: 12, icon: FolderOpen, color: "text-primary", bg: "bg-primary/10" },
  { label: "Delivered", value: 45, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100" },
  { label: "Pending Approval", value: 3, icon: ClipboardCheck, color: "text-yellow-600", bg: "bg-yellow-100" },
  { label: "On Hold", value: 2, icon: PauseCircle, color: "text-blue-600", bg: "bg-blue-100" },
  { label: "Cancelled", value: 1, icon: XCircle, color: "text-gray-600", bg: "bg-gray-100" },
];

const monthlyVolume = [
  { month: "Dec", cases: 22 },
  { month: "Jan", cases: 28 },
  { month: "Feb", cases: 31 },
  { month: "Mar", cases: 35 },
  { month: "Apr", cases: 42 },
  { month: "May", cases: 18 },
];

const breakdown = [
  { name: "Crown & Bridge", value: 65, color: "hsl(158,64%,28%)" },
  { name: "Implants", value: 20, color: "hsl(152,60%,45%)" },
  { name: "Removables", value: 10, color: "hsl(38,92%,50%)" },
  { name: "Orthodontics", value: 5, color: "hsl(200,90%,45%)" },
];

const tatTrend = [
  { month: "Dec", tat: 5.8 },
  { month: "Jan", tat: 5.5 },
  { month: "Feb", tat: 5.1 },
  { month: "Mar", tat: 4.8 },
  { month: "Apr", tat: 4.5 },
  { month: "May", tat: 4.3 },
];

const recentCases = [
  { id: "CAS-7281", restoration: "Zirconia Crown", status: "In Design", patientRef: "PR-8821", caseType: "C&B", toothNumbers: [14] },
  { id: "CAS-7279", restoration: "Bridge (3-unit)", status: "Internal QC", patientRef: "PR-8819", caseType: "C&B", toothNumbers: [3, 4, 5] },
  { id: "CAS-7275", restoration: "Night Guard", status: "Completed", patientRef: "PR-8812", caseType: "Removables", toothNumbers: [] },
  { id: "CAS-7272", restoration: "Implant Abutment", status: "Submitted", patientRef: "PR-8801", caseType: "Implants", toothNumbers: [19] },
  { id: "CAS-7268", restoration: "Zirconia Crown", status: "On Hold", patientRef: "PR-8792", caseType: "C&B", toothNumbers: [30] },
];

export default function Dashboard() {
  const router = useRouter();

  const { data: casesData } = useQuery<{ data: any[] }>({
    queryKey: ["dashboard-cases"],
    queryFn: async () => {
      const res = await fetch("/api/cases");
      if (!res.ok) throw new Error("Failed to fetch cases");
      return res.json();
    },
    refetchInterval: 8000,
  });

  const cases = casesData?.data || [];

  const activeCount = cases.filter((c: any) => ["scan_received", "scan_verified", "allocated_to_designer", "in_progress", "internal_qc"].includes(c.status)).length;
  const deliveredCount = cases.filter((c: any) => ["approved", "delivered"].includes(c.status)).length;
  const pendingCount = cases.filter((c: any) => c.status === "submitted_to_client").length;
  const holdCount = cases.filter((c: any) => ["on_hold", "scan_not_verified"].includes(c.status)).length;
  const cancelledCount = cases.filter((c: any) => c.status === "cancelled").length;

  const dynamicKpis = [
    { label: "Active / In Progress", value: activeCount, icon: FolderOpen, color: "text-primary", bg: "bg-primary/10" },
    { label: "Delivered", value: deliveredCount, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100" },
    { label: "Pending Approval", value: pendingCount, icon: ClipboardCheck, color: "text-yellow-600", bg: "bg-yellow-100" },
    { label: "On Hold", value: holdCount, icon: PauseCircle, color: "text-blue-600", bg: "bg-blue-100" },
    { label: "Cancelled", value: cancelledCount, icon: XCircle, color: "text-gray-600", bg: "bg-gray-100" },
  ];

  return (
    <OpsLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Welcome back, PrecisionDent Lab</h1>
          <p className="text-muted-foreground text-sm mt-1">Here's how your design pipeline is doing today</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {dynamicKpis.map((kpi) => (
            <Card
              key={kpi.label}
              className="shadow-card hover:shadow-elevated transition-shadow cursor-pointer"
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
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyVolume}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,90%)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(150,18%,90%)" }} />
                  <Bar dataKey="cases" fill="hsl(158,64%,28%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Case Breakdown by Type</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={breakdown} cx="50%" cy="50%" innerRadius={42} outerRadius={72} dataKey="value" paddingAngle={2}>
                    {breakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip />
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
            </CardContent>
          </Card>
        </div>

        {/* Avg TAT trend + Recent cases */}
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
              <CardContent>
                <div className="flex items-end gap-2">
                  <p className="text-4xl font-semibold text-foreground">4.3</p>
                  <p className="text-sm text-muted-foreground pb-1.5">days</p>
                  <span className="ml-auto text-xs text-green-600 flex items-center gap-1 pb-1.5">
                    <TrendingUp className="h-3 w-3" /> 12% faster
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={tatTrend}>
                    <Line type="monotone" dataKey="tat" stroke="hsl(158,64%,28%)" strokeWidth={2.5} dot={{ r: 3 }} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(158,12%,42%)" />
                    <Tooltip />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card className="lg:col-span-2 shadow-card">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium">Recent Cases</CardTitle>
              <button className="text-xs text-primary hover:underline">View all</button>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentCases.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{c.id} · {c.restoration}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.caseType} · Patient ref {c.patientRef}{c.toothNumbers.length > 0 ? ` · #${c.toothNumbers.join(", #")}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </OpsLayout>
  );
}