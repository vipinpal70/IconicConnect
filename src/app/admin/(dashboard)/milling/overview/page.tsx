"use client"

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { MillingSubNav } from "../_components/MillingSubNav";
import { Factory, Truck, TrendingUp, Clock, AlertCircle, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import type { MillingCenter } from "@/src/db/schema/milling";

interface CenterStat {
  centerId: string;
  centerName: string;
  active: boolean;
  caseCount: number;
  activeCaseCount: number;
  partnerCost: number;
  customerRevenue: number;
  margin: number;
  avgTatDays: number | null;
  remakeRate: number | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Failed to load ${url}`);
  }
  const json = await res.json();
  return json.data;
}

export default function MillingOverviewPage() {
  const router = useRouter();

  const { data: centers = [], isLoading: centersLoading } = useQuery<MillingCenter[]>({
    queryKey: ["admin-milling-centers"],
    queryFn: () => fetchJson("/api/admin/milling/centers"),
  });

  const { data: stats = [], isLoading: statsLoading } = useQuery<CenterStat[]>({
    queryKey: ["admin-milling-analytics"],
    queryFn: () => fetchJson("/api/admin/milling/analytics"),
  });

  const isLoading = centersLoading || statsLoading;

  const activeCases = stats.reduce((s, c) => s + c.activeCaseCount, 0);
  const delivered = stats.reduce((s, c) => s + (c.caseCount - c.activeCaseCount), 0);
  const tatValues = stats.map((c) => c.avgTatDays).filter((v): v is number => v !== null);
  const avgTat = tatValues.length ? tatValues.reduce((a, b) => a + b, 0) / tatValues.length : null;

  const statByCenter = new Map(stats.map((s) => [s.centerId, s]));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Milling Network</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Central control for all milling partners · {centers.length} centres · Hidden from clients
          </p>
        </div>
        <Button onClick={() => router.push("/admin/milling/centers")}>Onboard New Centre</Button>
      </div>

      <MillingSubNav />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat icon={<Factory className="h-4 w-4" />} label="Partner centres" value={`${centers.filter((c) => c.active).length}/${centers.length}`} sub="active" />
            <Stat icon={<Truck className="h-4 w-4" />} label="Active milling cases" value={String(activeCases)} sub="across all partners" />
            <Stat icon={<TrendingUp className="h-4 w-4" />} label="Delivered" value={String(delivered)} sub="all-time" />
            <Stat icon={<Clock className="h-4 w-4" />} label="Avg TAT" value={avgTat !== null ? `${avgTat.toFixed(1)}d` : "—"} sub="network average, delivered cases" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {centers.map((c) => {
              const stat = statByCenter.get(c.id);
              return (
                <Card key={c.id} className="shadow-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base font-semibold">{c.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">{[c.city, c.state].filter(Boolean).join(", ")} · {c.country}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                        {c.active ? "Active" : "Paused"}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-muted-foreground">Active cases</p><p className="text-foreground font-semibold">{stat?.activeCaseCount ?? 0}</p></div>
                      <div><p className="text-muted-foreground">Delivered</p><p className="text-foreground font-semibold">{stat ? stat.caseCount - stat.activeCaseCount : 0}</p></div>
                      <div><p className="text-muted-foreground">Avg TAT</p><p className="text-foreground font-semibold">{stat?.avgTatDays !== null && stat?.avgTatDays !== undefined ? `${stat.avgTatDays}d` : "—"}</p></div>
                    </div>
                    <Button variant="outline" size="sm" className="w-full" onClick={() => router.push("/admin/milling/centers")}>
                      Manage <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Card className="shadow-card border-warning/30 bg-warning/5">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Client visibility rule</p>
            <p className="text-muted-foreground mt-1">
              Dental labs never see which milling centre produces their cases. All milling activity is presented as
              &quot;Fulfilled by Iconic Dental&quot; on the lab portal.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card className="shadow-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}<span>{label}</span></div>
        <p className="text-2xl font-semibold text-foreground mt-2">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
