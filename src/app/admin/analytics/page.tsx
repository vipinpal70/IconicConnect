"use client"

import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const PALETTE = [
  "hsl(158,64%,28%)", "hsl(152,60%,45%)", "hsl(38,92%,50%)",
  "hsl(200,90%,45%)", "hsl(280,55%,55%)", "hsl(350,70%,55%)",
];
const DELIVERY_COLORS: Record<string, string> = {
  "Completed": "hsl(152,64%,36%)",
  "In Progress": "hsl(158,64%,28%)",
  "Awaiting Client": "hsl(38,92%,50%)",
  "Feedback": "hsl(0,72%,51%)",
  "On Hold": "hsl(200,90%,45%)",
  "Cancelled": "hsl(158,12%,42%)",
};

const BASE = "/api/admin/analytics";

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted/60 ${className}`} />;
}

export default function AnalyticsPage() {
  const now = new Date();
  const monthName = now.toLocaleString("default", { month: "long" });

  const { data: kpis, isLoading: kpisLoading } = useQuery<{
    totalCases: number; avgTat: string; casesOnHold: number; currentMonthBilling: number;
  }>({ queryKey: ["analytics-kpis"], queryFn: () => fetch(`${BASE}/kpis`).then((r) => r.json()) });

  const { data: tatTrend, isLoading: tatLoading } = useQuery<{ month: string; tat: number }[]>({
    queryKey: ["analytics-tat-trend"],
    queryFn: () => fetch(`${BASE}/tat-trend`).then((r) => r.json()),
  });

  const { data: deliveryStatus, isLoading: deliveryLoading } = useQuery<{ name: string; value: number }[]>({
    queryKey: ["analytics-delivery-status"],
    queryFn: () => fetch(`${BASE}/delivery-status`).then((r) => r.json()),
  });

  const { data: monthlyBilling, isLoading: billingLoading } = useQuery<{ month: string; amount: number }[]>({
    queryKey: ["analytics-monthly-billing"],
    queryFn: () => fetch(`${BASE}/monthly-billing`).then((r) => r.json()),
  });

  const { data: typeMix, isLoading: typeLoading } = useQuery<{ name: string; value: number }[]>({
    queryKey: ["analytics-type-mix"],
    queryFn: () => fetch(`${BASE}/type-mix`).then((r) => r.json()),
  });

  const { data: onHoldReasons, isLoading: holdLoading } = useQuery<{ reason: string; count: number }[]>({
    queryKey: ["analytics-on-hold-reasons"],
    queryFn: () => fetch(`${BASE}/on-hold-reasons`).then((r) => r.json()),
  });

  const { data: recentInvoices, isLoading: invoicesLoading } = useQuery<{
    id: string; invoiceNumber: string; period: string; caseCount: number; amount: number; status: string;
  }[]>({
    queryKey: ["analytics-recent-invoices"],
    queryFn: () => fetch(`${BASE}/recent-invoices`).then((r) => r.json()),
  });

  const typeMixWithColors = (Array.isArray(typeMix) ? typeMix : []).map((t, i) => ({ ...t, color: PALETTE[i % PALETTE.length] }));
  const deliveryWithColors = (Array.isArray(deliveryStatus) ? deliveryStatus : []).map((d) => ({
    ...d,
    color: DELIVERY_COLORS[d.name] ?? PALETTE[0],
  }));

  const kpiCards = [
    { label: "Total Cases", value: kpisLoading ? null : kpis?.totalCases, sub: "lifetime" },
    { label: "Avg TAT", value: kpisLoading ? null : kpis?.avgTat, sub: "last 30 days", positive: true },
    { label: "Cases On Hold", value: kpisLoading ? null : kpis?.casesOnHold, sub: "needs action" },
    { label: `${monthName} Billing`, value: kpisLoading ? null : kpis && typeof kpis.currentMonthBilling === 'number' ? `$${kpis.currentMonthBilling.toLocaleString()}` : 'N/A', sub: "current month" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Analytics & Reports</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Performance, delivery and billing insights for your account</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpiCards.map((k) => (
            <Card key={k.label} className="shadow-card border-border/50">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{k.label}</p>
                {k.value === null ? (
                  <Skeleton className="h-6 w-16 mt-1" />
                ) : (
                  <p className="text-xl font-semibold text-foreground mt-0.5">{k.value}</p>
                )}
                <p className={`text-[10px] mt-0.5 ${k.positive ? "text-green-600 font-semibold" : "text-muted-foreground"}`}>{k.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* TAT Trend + Delivery Status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Average TAT Trend</CardTitle>
            </CardHeader>
            <CardContent className="p-3.5">
              {tatLoading ? (
                <Skeleton className="h-[160px] w-full" />
              ) : (
                <div className="h-[160px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={Array.isArray(tatTrend) ? tatTrend : []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,95%)" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" unit=" d" />
                      <Tooltip />
                      <Line type="monotone" dataKey="tat" stroke="hsl(158,64%,28%)" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Case Delivery Status</CardTitle>
            </CardHeader>
            <CardContent className="p-3 flex flex-col items-center justify-between">
              {deliveryLoading ? (
                <Skeleton className="h-[160px] w-full" />
              ) : (
                <>
                  <div className="h-[120px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={deliveryWithColors} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={2}>
                          {deliveryWithColors.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] mt-1.5 w-full">
                    {deliveryWithColors.map((d) => (
                      <div key={d.name} className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-muted-foreground truncate font-semibold">{d.name} ({d.value})</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Monthly Billing + Case Mix */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Monthly Billing Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-3.5">
              {billingLoading ? (
                <Skeleton className="h-[160px] w-full" />
              ) : (
                <div className="h-[160px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Array.isArray(monthlyBilling) ? monthlyBilling : []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,95%)" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" tickFormatter={(v: any) => `$${v}`} />
                      <Tooltip formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
                      <Bar dataKey="amount" fill="hsl(152,60%,45%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Case Mix by Type</CardTitle>
            </CardHeader>
            <CardContent className="p-3.5">
              {typeLoading ? (
                <Skeleton className="h-[160px] w-full" />
              ) : (
                <div className="h-[160px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={typeMixWithColors} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,95%)" />
                      <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(158,12%,42%)" width={90} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {typeMixWithColors.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* On-Hold Reasons */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On-Hold Reasons (last 90 days)</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {holdLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : (Array.isArray(onHoldReasons) ? onHoldReasons : []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No cases on hold in the last 90 days.</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {(Array.isArray(onHoldReasons) ? onHoldReasons : []).map((r) => (
                  <div key={r.reason} className="rounded bg-muted/20 px-3 py-2 border border-border/50">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{r.reason}</p>
                    <p className="text-lg font-semibold text-foreground mt-0.5">{r.count}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Invoices */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {invoicesLoading ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/30">
                    <tr className="border-b border-border">
                      {["Invoice", "Period", "Cases", "Amount", "Status"].map((h) => (
                        <th key={h} className="text-left px-3.5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(Array.isArray(recentInvoices) ? recentInvoices : []).map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-3.5 py-1.5 text-[11px] font-semibold text-primary">{inv.invoiceNumber}</td>
                        <td className="px-3.5 py-1.5 text-[11px] text-foreground">{inv.period}</td>
                        <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground">{inv.caseCount}</td>
                        <td className="px-3.5 py-1.5 text-[11px] font-semibold text-foreground">${inv.amount.toLocaleString()}</td>
                        <td className="px-3.5 py-1.5">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold scale-95 origin-left ${inv.status === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
