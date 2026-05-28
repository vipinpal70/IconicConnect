"use client";

import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { StatusBadge } from "@/src/components/StatusBadge";
import { cases, activityFeed } from "@/src/data/demoData";
import { Inbox, Layers, ShieldCheck, ClipboardCheck, Users, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const counts = {
  incoming: cases.filter((c) => c.status === "Submitted" || c.status === "In Validation").length,
  inDesign: cases.filter((c) => c.status === "In Design").length,
  internalQc: cases.filter((c) => c.status === "Internal QC").length,
  pendingClient: cases.filter((c) => c.status === "Pending Client Approval").length,
  activeClients: 42, // Static for now as per reference
};

const designerLoad = [
  { name: "Alex", load: 8 },
  { name: "Michael", load: 5 },
  { name: "Emma", load: 12 },
  { name: "Sarah", load: 3 },
  { name: "David", load: 9 },
];

export default function AdminDashboard() {
  const router = useRouter();
  const recent = [...cases].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 6);

  const kpis = [
    { label: "Validated", value: counts.incoming, icon: Inbox, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "In Design", value: counts.inDesign, icon: Layers, color: "text-primary", bg: "bg-primary/10" },
    { label: "Internal QC", value: counts.internalQc, icon: ShieldCheck, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "Client Approval", value: counts.pendingClient, icon: ClipboardCheck, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { label: "Active Clients", value: counts.activeClients, icon: Users, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-4 animate-fade-in text-xs">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold text-foreground">Iconic Connect — Admin</h1>
          <p className="text-xs text-muted-foreground">Operational overview across all client labs</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {kpis.map((k) => (
            <Card
              key={k.label}
              className="shadow-card hover:shadow-glow transition-all cursor-pointer border-border/50"
              onClick={() => router.push("/admin/cases")}
            >
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">{k.label}</p>
                    <p className="text-2xl font-semibold text-foreground mt-0.5">{k.value}</p>
                  </div>
                  <div className={`p-2 rounded-lg shrink-0 ${k.bg} ${k.color} shadow-sm`}>
                    <k.icon className="h-3.5 w-3.5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 shadow-card border-border/50">
            <CardHeader className="p-3.5 pb-2 border-b border-border/60 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-semibold">Recent Case Activity</CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] text-primary px-2" onClick={() => router.push("/admin/cases")}>View All</Button>
            </CardHeader>
            <CardContent className="p-0">
              {recent.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-3.5 py-2 border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => router.push(`/admin/cases/${c.id}`)}
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground">{c.id} · PrecisionDent</p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{c.caseType} · {c.restoration} · designer {c.designer ?? "unallocated"}</p>
                  </div>
                  <div className="scale-90 origin-right shrink-0 ml-3">
                    <StatusBadge status={c.status} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="p-3.5 pb-2 border-b border-border/60 space-y-0">
              <CardTitle className="text-xs font-semibold">Designer Workload</CardTitle>
            </CardHeader>
            <CardContent className="p-3.5 pt-3">
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={designerLoad} layout="vertical" margin={{ left: -20, right: 12, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} stroke="none" width={56} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '11px' }}
                  />
                  <Bar dataKey="load" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/50">
          <CardHeader className="p-3.5 pb-2 border-b border-border/60 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold text-foreground">Active Clients Overview</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-[10px] text-primary px-2" onClick={() => router.push("/admin/clients")}>Manage Clients</Button>
          </CardHeader>
          <CardContent className="p-3.5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { id: "CL-001", company: "PrecisionDent Lab", location: "Miami, FL", volume: 145 },
              { id: "CL-002", company: "SmileCraft Center", location: "Austin, TX", volume: 82 },
              { id: "CL-003", company: "CityDental Labs", location: "New York, NY", volume: 210 },
            ].map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-border/50 p-3 hover:shadow-glow transition-all cursor-pointer bg-card/50"
                onClick={() => router.push("/admin/clients")}
              >
                <p className="text-[11px] font-semibold text-foreground mb-0.5">{c.company}</p>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-2.5 w-2.5" /> {c.location}
                </p>
                <div className="mt-2 pt-2 border-t border-border/50 flex justify-between items-center">
                  <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Volume</span>
                  <span className="text-[11px] font-semibold text-primary">~{c.volume} cases/mo</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
