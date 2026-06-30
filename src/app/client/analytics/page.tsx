"use client"

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClientLayout } from "@/src/components/ClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
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

const BASE = "/api/client/analytics";

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted/60 ${className}`} />;
}

export default function AnalyticsPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  const [from, setFrom] = useState<string>(thirtyDaysAgo.toISOString().split("T")[0]);
  const [to, setTo] = useState<string>(now.toISOString().split("T")[0]);

  const monthName = now.toLocaleString("default", { month: "long" });

  const { data: kpis, isLoading: kpisLoading } = useQuery<{
    totalCases: number; avgTat: string; casesOnHold: number; currentMonthBilling: number;
  }>({
    queryKey: ["client-analytics-kpis", from, to],
    queryFn: () => fetch(`${BASE}/kpis?from=${from}&to=${to}`).then((r) => r.json())
  });

  const { data: tatTrend, isLoading: tatLoading } = useQuery<{ month: string; tat: number }[]>({
    queryKey: ["client-analytics-tat-trend", from, to],
    queryFn: () => fetch(`${BASE}/tat-trend?from=${from}&to=${to}`).then((r) => r.json()),
  });

  const { data: deliveryStatus, isLoading: deliveryLoading } = useQuery<{ name: string; value: number }[]>({
    queryKey: ["client-analytics-delivery-status", from, to],
    queryFn: () => fetch(`${BASE}/delivery-status?from=${from}&to=${to}`).then((r) => r.json()),
  });

  const { data: monthlyBilling, isLoading: billingLoading } = useQuery<{ month: string; amount: number }[]>({
    queryKey: ["client-analytics-monthly-billing", from, to],
    queryFn: () => fetch(`${BASE}/monthly-billing?from=${from}&to=${to}`).then((r) => r.json()),
  });

  const { data: typeMix, isLoading: typeLoading } = useQuery<{ name: string; value: number }[]>({
    queryKey: ["client-analytics-type-mix", from, to],
    queryFn: () => fetch(`${BASE}/type-mix?from=${from}&to=${to}`).then((r) => r.json()),
  });

  const { data: onHoldReasons, isLoading: holdLoading } = useQuery<{ reason: string; count: number }[]>({
    queryKey: ["client-analytics-on-hold-reasons", from, to],
    queryFn: () => fetch(`${BASE}/on-hold-reasons?from=${from}&to=${to}`).then((r) => r.json()),
  });

  const { data: recentInvoices, isLoading: invoicesLoading } = useQuery<{
    id: string; invoiceNumber: string; period: string; caseCount: number; amount: number; status: string;
  }[]>({
    queryKey: ["client-analytics-recent-invoices", from, to],
    queryFn: () => fetch(`${BASE}/recent-invoices?from=${from}&to=${to}`).then((r) => r.json()),
  });

  const typeMixWithColors = (Array.isArray(typeMix) ? typeMix : []).map((t, i) => ({ ...t, color: PALETTE[i % PALETTE.length] }));
  const deliveryWithColors = (Array.isArray(deliveryStatus) ? deliveryStatus : []).map((d) => ({
    ...d,
    color: DELIVERY_COLORS[d.name] ?? PALETTE[0],
  }));

  const kpiCards = [
    {
      label: "Total Cases",
      value: kpisLoading ? null : kpis?.totalCases,
      sub: "selected period"
    },
    {
      label: "Avg TAT",
      value: kpisLoading ? null : kpis?.avgTat,
      sub: "selected period",
      positive: true
    },
    {
      label: "Cases On Hold",
      value: kpisLoading ? null : kpis?.casesOnHold,
      sub: "needs action"
    },
    {
      label: "Period Billing",
      value: kpisLoading ? null : kpis && typeof kpis.currentMonthBilling === 'number' ? `$${kpis.currentMonthBilling.toLocaleString()}` : 'N/A',
      sub: "selected period"
    },
  ];

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Analytics & Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Performance, delivery and billing insights for your account</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">From:</span>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs w-36 cursor-pointer bg-background"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">To:</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs w-36 cursor-pointer bg-background"
              />
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpiCards.map((k) => (
            <Card key={k.label} className="shadow-card border-border/50">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{k.label}</p>
                {k.value === null ? (
                  <Skeleton className="h-6 w-16 mt-1" />
                ) : (
                  <p className="text-xl font-black text-foreground mt-0.5">{k.value}</p>
                )}
                <p className={`text-[10px] mt-0.5 ${k.positive ? "text-green-600 font-bold" : "text-muted-foreground"}`}>{k.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* TAT Trend + Delivery Status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Average TAT Trend</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {tatLoading ? (
                <Skeleton className="h-[200px] w-full mt-2" />
              ) : (
                <div className="h-[200px] w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={Array.isArray(tatTrend) ? tatTrend : []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,90%)" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" unit=" d" />
                      <Tooltip contentStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="tat" stroke="hsl(158,64%,28%)" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Case Delivery Status</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 flex flex-col items-center">
              {deliveryLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : (
                <>
                  <div className="h-[150px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={deliveryWithColors} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value" paddingAngle={2}>
                          {deliveryWithColors.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] mt-1.5 w-full">
                    {deliveryWithColors.map((d) => (
                      <div key={d.name} className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-muted-foreground truncate">{d.name} ({d.value})</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Monthly Billing + Case Mix */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Monthly Billing Summary</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {billingLoading ? (
                <Skeleton className="h-[200px] w-full mt-2" />
              ) : (
                <div className="h-[200px] w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Array.isArray(monthlyBilling) ? monthlyBilling : []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,90%)" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" tickFormatter={(v: any) => `$${v}`} />
                      <Tooltip contentStyle={{ fontSize: 10 }} formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
                      <Bar dataKey="amount" fill="hsl(152,60%,45%)" radius={[4, 4, 0, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Case Mix by Type</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {typeLoading ? (
                <Skeleton className="h-[200px] w-full mt-2" />
              ) : (
                <div className="h-[200px] w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={typeMixWithColors} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,90%)" />
                      <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" width={110} />
                      <Tooltip contentStyle={{ fontSize: 10 }} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
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
          <CardHeader className="py-2.5 px-4">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">On-Hold Reasons (last 90 days)</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {holdLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : (Array.isArray(onHoldReasons) ? onHoldReasons : []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No cases on hold in the last 90 days.</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {(Array.isArray(onHoldReasons) ? onHoldReasons : []).map((r) => (
                  <div key={r.reason} className="rounded px-3 py-1.5 bg-muted/40 border border-border/50">
                    <p className="text-[10px] font-medium text-muted-foreground leading-tight">{r.reason}</p>
                    <p className="text-base font-bold text-foreground mt-0.5">{r.count}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Invoices */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recent Invoices</CardTitle>
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
                        <th key={h} className="text-left px-3.5 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(Array.isArray(recentInvoices) ? recentInvoices : []).map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-3.5 py-2 text-[11px] font-bold text-primary">{inv.invoiceNumber}</td>
                        <td className="px-3.5 py-2 text-[11px] text-foreground">{inv.period}</td>
                        <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{inv.caseCount}</td>
                        <td className="px-3.5 py-2 text-[11px] font-semibold text-foreground">${inv.amount.toLocaleString()}</td>
                        <td className="px-3.5 py-2">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold scale-95 origin-left ${inv.status === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
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
    </ClientLayout>
  );
}
