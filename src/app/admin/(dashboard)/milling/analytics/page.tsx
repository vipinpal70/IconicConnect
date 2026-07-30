"use client"

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { MillingSubNav } from "../_components/MillingSubNav";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import type { PriceListEntryFull } from "@/src/lib/price-list-shared";

const COLORS = ["hsl(158, 64%, 28%)", "hsl(152, 60%, 45%)", "hsl(200, 90%, 45%)", "hsl(38, 92%, 50%)", "hsl(280, 55%, 55%)"];

interface CenterStat {
  centerId: string;
  centerName: string;
  active: boolean;
  caseCount: number;
  activeCaseCount: number;
  customerRevenue: number;
  avgTatDays: number | null;
  remakeRate: number | null;
}

interface MillingCaseRow {
  category: string | null;
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

export default function MillingAnalyticsPage() {
  const { data: stats = [], isLoading: statsLoading } = useQuery<CenterStat[]>({
    queryKey: ["admin-milling-analytics"],
    queryFn: () => fetchJson("/api/admin/milling/analytics"),
  });

  const { data: cases = [], isLoading: casesLoading } = useQuery<MillingCaseRow[]>({
    queryKey: ["admin-milling-cases"],
    queryFn: () => fetchJson("/api/admin/milling/cases"),
  });

  const { data: priceList = [] } = useQuery<PriceListEntryFull[]>({
    queryKey: ["admin-service-catalog", "design_milling"],
    queryFn: () => fetchJson("/api/admin/service-catalog?serviceType=design_milling"),
  });

  const isLoading = statsLoading || casesLoading;

  const perCenter = stats.map((c) => ({ name: c.centerName.split(" ")[0], cases: c.caseCount, revenue: c.customerRevenue, tat: c.avgTatDays ?? 0 }));

  const productMix = Array.from(new Set(cases.map((c) => c.category).filter((c): c is string => Boolean(c)))).map((category) => ({
    name: category,
    value: cases.filter((c) => c.category === category).length,
  }));

  const totalRevenue = stats.reduce((s, c) => s + c.customerRevenue, 0);
  const activeCases = stats.reduce((s, c) => s + c.activeCaseCount, 0);
  const tatValues = stats.map((c) => c.avgTatDays).filter((v): v is number => v !== null);
  const avgTat = tatValues.length ? tatValues.reduce((a, b) => a + b, 0) / tatValues.length : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Milling Performance</h1>
        <p className="text-sm text-muted-foreground mt-1">Cost, revenue and TAT analytics across all milling partners</p>
      </div>

      <MillingSubNav />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <KPI label="Revenue" value={`$${(totalRevenue / 1000).toFixed(1)}k`} sub="all partners" tone="primary" />
            <KPI label="Avg TAT" value={avgTat !== null ? `${avgTat.toFixed(1)}d` : "—"} sub="delivered cases" tone="info" />
            <KPI label="Active cases" value={String(activeCases)} sub="in production network-wide" tone="warning" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-base">Cases by milling centre</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={perCenter}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="cases" fill="hsl(158, 64%, 28%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-base">Avg TAT by centre (days)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={perCenter}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="tat" fill="hsl(200, 90%, 45%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-base">Product mix</CardTitle></CardHeader>
              <CardContent>
                {productMix.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-16">No Design + Milling cases yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={productMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                        {productMix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-base">Design + Milling price list snapshot</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {priceList.length === 0 ? (
                <p className="text-xs text-muted-foreground">No Design + Milling catalog items yet.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {priceList.slice(0, 8).map((r) => (
                    <div key={r.id} className="border border-border rounded-md p-3">
                      <p className="text-xs text-muted-foreground">{r.category}</p>
                      <p className="text-foreground font-medium truncate">{r.subCategory}</p>
                      <p className="text-primary font-semibold mt-1">${r.defaultPrice.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KPI({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  const color = { primary: "text-primary", success: "text-success", info: "text-info", warning: "text-warning" }[tone] ?? "text-foreground";
  return (
    <Card className="shadow-card">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
