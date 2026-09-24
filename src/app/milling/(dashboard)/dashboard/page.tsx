"use client"

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Factory, PenTool, CheckCircle2, Truck, Package, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { dueDateTone, DUE_DATE_TONE_CLASSES } from "@/src/lib/milling/due-date";

interface MillingMe {
  fullName: string | null;
  email: string;
  center: { name: string } | null;
}

interface DueSoonRow {
  caseId: string;
  caseNumber: string | null;
  subCategory: string | null;
  category: string | null;
  dueDate: string | null;
  queue: "design" | "production";
  status: string;
  overdue: boolean;
}

interface CapacityRow {
  category: string;
  subCategory: string;
  used: number;
  cap: number;
}

interface MillingDashboardData {
  buckets: Record<string, number>;
  currentLoad: number;
  designQueueCount: number;
  avgTatDays: number | null;
  dueSoon: DueSoonRow[];
  capacity: CapacityRow[];
}

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  createdAt: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const json = await res.json();
  return json.data;
}

export default function MillingDashboardPage() {
  const router = useRouter();

  const { data: me } = useQuery<MillingMe>({
    queryKey: ["milling-me"],
    queryFn: () => fetchJson("/api/milling/me"),
  });

  const { data: dashboard, isLoading } = useQuery<MillingDashboardData>({
    queryKey: ["milling-dashboard"],
    queryFn: () => fetchJson("/api/milling/dashboard"),
  });

  const { data: notifications = [] } = useQuery<NotificationRow[]>({
    queryKey: ["notifications", "milling-dashboard"],
    queryFn: () => fetchJson("/api/notifications?limit=5"),
  });

  const buckets = dashboard?.buckets ?? {};
  const dueSoon = dashboard?.dueSoon ?? [];
  const capacity = dashboard?.capacity ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Production Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Welcome back, {me?.fullName || me?.email} · {me?.center?.name}</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat icon={<PenTool className="h-4 w-4" />} label="Design queue" value={dashboard?.designQueueCount ?? 0} tone="accent" />
            <Stat icon={<Package className="h-4 w-4" />} label="Ready for milling" value={buckets.ready_for_milling ?? 0} tone="info" />
            <Stat icon={<Factory className="h-4 w-4" />} label="In production" value={buckets.milling_in_progress ?? 0} tone="primary" />
            <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Milling QC" value={buckets.milling_qc ?? 0} tone="warning" />
            <Stat icon={<Truck className="h-4 w-4" />} label="Shipped" value={(buckets.dispatched ?? 0) + (buckets.delivered ?? 0)} tone="success" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="shadow-card lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-base">Production summary</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-xs text-muted-foreground">Active cases</p><p className="text-2xl font-semibold text-foreground">{dashboard?.currentLoad ?? 0}</p></div>
                  <div><p className="text-xs text-muted-foreground">Avg TAT (delivered)</p><p className="text-2xl font-semibold text-foreground">{dashboard?.avgTatDays !== null && dashboard?.avgTatDays !== undefined ? `${dashboard.avgTatDays}d` : "—"}</p></div>
                </div>
                <div className="mt-6 flex gap-2">
                  <Button className="flex-1" variant="outline" onClick={() => router.push("/milling/cases?queue=design")}>
                    <PenTool className="h-3.5 w-3.5 mr-1.5" /> Design Queue
                  </Button>
                  <Button className="flex-1" onClick={() => router.push("/milling/cases?queue=production")}>
                    <Factory className="h-3.5 w-3.5 mr-1.5" /> Production Queue
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-base">Notifications</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {notifications.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No notifications yet.</p>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className="text-sm border-b border-border last:border-0 pb-2 last:pb-0">
                      <p className="text-foreground">{n.title}</p>
                      <p className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="shadow-card lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Due soon
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {dueSoon.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">Nothing actionable is due soon.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {dueSoon.map((row) => {
                      const tone = row.overdue ? "overdue" : dueDateTone(row.dueDate);
                      return (
                        <button
                          key={`${row.caseId}-${row.queue}`}
                          onClick={() => router.push(`/milling/cases/${row.caseId}`)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium text-primary">{row.caseNumber ?? row.caseId}</p>
                            <p className="text-xs text-muted-foreground">{row.subCategory ?? row.category ?? "—"} · {row.queue === "design" ? "Design" : "Production"}</p>
                          </div>
                          <p className={`text-xs whitespace-nowrap ${DUE_DATE_TONE_CLASSES[tone]}`}>
                            {row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "No due date"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-base">Capacity this month</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {capacity.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No monthly capacity limits set on your services.</p>
                ) : (
                  capacity.map((row) => {
                    const pct = row.cap > 0 ? Math.min(100, Math.round((row.used / row.cap) * 100)) : 0;
                    const barColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
                    return (
                      <div key={`${row.category}-${row.subCategory}`}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-foreground font-medium">{row.subCategory}</span>
                          <span className="text-muted-foreground">{row.used}/{row.cap}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  const color = { primary: "text-primary", success: "text-success", info: "text-info", warning: "text-warning", accent: "text-accent-foreground" }[tone] ?? "text-foreground";
  return (
    <Card className="shadow-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}<span>{label}</span></div>
        <p className={`text-3xl font-semibold mt-2 ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
