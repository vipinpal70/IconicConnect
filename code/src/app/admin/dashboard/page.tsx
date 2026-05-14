"use client";

import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { StatusBadge } from "@/src/components/StatusBadge";
import { cases, activityFeed } from "@/src/data/demoData";
import { Inbox, Layers, ShieldCheck, ClipboardCheck, Users } from "lucide-react";
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
    { label: "Incoming / Validation", value: counts.incoming, icon: Inbox, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "In Design", value: counts.inDesign, icon: Layers, color: "text-primary", bg: "bg-primary/10" },
    { label: "Awaiting Internal QC", value: counts.internalQc, icon: ShieldCheck, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "Awaiting Client Approval", value: counts.pendingClient, icon: ClipboardCheck, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { label: "Active Clients", value: counts.activeClients, icon: Users, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Iconic Connect — Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Operational overview across all client labs</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {kpis.map((k) => (
            <Card key={k.label} className="shadow-card hover:shadow-glow transition-all cursor-pointer border-border/50" onClick={() => router.push("/admin/cases")}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{k.label}</p>
                    <p className="text-3xl font-bold text-foreground mt-1">{k.value}</p>
                  </div>
                  <div className={`p-2.5 rounded-xl ${k.bg} ${k.color} shadow-sm`}><k.icon className="h-4 w-4" /></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 shadow-card border-border/50">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">Recent Case Activity</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => router.push("/admin/cases")}>View All</Button>
            </CardHeader>
            <CardContent className="space-y-1">
              {recent.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/30 -mx-2 px-3 rounded-lg transition-colors" onClick={() => router.push(`/admin/cases/${c.id}`)}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{c.id} · PrecisionDent</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.caseType} · {c.restoration} · designer {c.designer ?? "unallocated"}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">Designer Workload</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={designerLoad} layout="vertical" margin={{ left: -20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} stroke="none" width={80} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="load" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/50">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold text-foreground">Active Clients Overview</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => router.push("/admin/clients")}>Manage Clients</Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { id: "CL-001", company: "PrecisionDent Lab", location: "Miami, FL", volume: 145 },
              { id: "CL-002", company: "SmileCraft Center", location: "Austin, TX", volume: 82 },
              { id: "CL-003", company: "CityDental Labs", location: "New York, NY", volume: 210 },
            ].map((c) => (
              <div key={c.id} className="rounded-xl border border-border/50 p-4 hover:shadow-glow transition-all cursor-pointer bg-card/50" onClick={() => router.push("/admin/clients")}>
                <p className="text-sm font-bold text-foreground mb-0.5">{c.company}</p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {c.location}</p>
                <div className="mt-3 pt-3 border-t border-border/50 flex justify-between items-center">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-tighter">Volume</span>
                  <span className="text-xs font-bold text-primary">~{c.volume} cases/mo</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

import { MapPin } from "lucide-react";
