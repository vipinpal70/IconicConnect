"use client"

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Factory, Clock, CheckCircle2, Truck, Package } from "lucide-react";
import { useRouter } from "next/navigation";

interface MillingMe {
  fullName: string | null;
  email: string;
  center: { name: string } | null;
}

interface MillingDashboardData {
  buckets: Record<string, number>;
  currentLoad: number;
  avgTatDays: number | null;
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
            <Stat icon={<Package className="h-4 w-4" />} label="Ready for milling" value={buckets.ready_for_milling ?? 0} tone="info" />
            <Stat icon={<Factory className="h-4 w-4" />} label="In production" value={buckets.milling_in_progress ?? 0} tone="primary" />
            <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Milling QC" value={buckets.milling_qc ?? 0} tone="warning" />
            <Stat icon={<Clock className="h-4 w-4" />} label="Packaging" value={buckets.packaging ?? 0} tone="accent" />
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
                <Button className="mt-6 w-full" onClick={() => router.push("/milling/cases")}>Open case queue</Button>
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
