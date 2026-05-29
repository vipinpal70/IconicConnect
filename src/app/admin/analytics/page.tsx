"use client"

import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { cases, invoices, caseTypes } from "@/src/data/demoData";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const total = cases.length;
const completed = cases.filter((c) => c.status === "Completed").length;
const onHold = cases.filter((c) => c.status === "On Hold").length;
const cancelled = cases.filter((c) => c.status === "Cancelled").length;

const tatTrend = [
  { month: "Dec", tat: 5.8 }, { month: "Jan", tat: 5.5 }, { month: "Feb", tat: 5.1 },
  { month: "Mar", tat: 4.8 }, { month: "Apr", tat: 4.5 }, { month: "May", tat: 4.3 },
];

const palette = ["hsl(158,64%,28%)", "hsl(152,60%,45%)", "hsl(38,92%,50%)", "hsl(200,90%,45%)", "hsl(280,55%,55%)", "hsl(350,70%,55%)"];
const typeMix = caseTypes.map((t, i) => ({ name: t, value: cases.filter((c) => c.caseType === t).length, color: palette[i % palette.length] }));

const deliveryStatus = [
  { name: "Completed", value: completed, color: "hsl(152,64%,36%)" },
  { name: "In Progress", value: cases.filter((c) => ["In Validation", "In Design", "Internal QC"].includes(c.status)).length, color: "hsl(158,64%,28%)" },
  { name: "Awaiting Client", value: cases.filter((c) => c.status === "Pending Client Approval").length, color: "hsl(38,92%,50%)" },
  { name: "Feedback", value: cases.filter((c) => c.status === "Feedback").length, color: "hsl(0,72%,51%)" },
  { name: "On Hold", value: onHold, color: "hsl(200,90%,45%)" },
  { name: "Cancelled", value: cancelled, color: "hsl(158,12%,42%)" },
].filter((d) => d.value > 0);

const monthlyBilling = [
  { month: "Dec", amount: 1640 }, { month: "Jan", amount: 2080 }, { month: "Feb", amount: 2310 },
  { month: "Mar", amount: 2640 }, { month: "Apr", amount: 2980 }, { month: "May", amount: 1240 },
];

const onHoldReasons = [
  { reason: "Missing bite scan", count: 4 },
  { reason: "Awaiting prescription", count: 2 },
  { reason: "Quality of scan", count: 3 },
  { reason: "Client paused", count: 1 },
];

export default function AnalyticsPage() {
  const kpis = [
    { label: "Total Cases", value: total, sub: "lifetime" },
    { label: "Avg TAT", value: "4.3 days", sub: "↓ 12% vs last month", positive: true },
    { label: "Cases On Hold", value: onHold, sub: "needs action" },
    { label: "May Billing", value: `$${monthlyBilling[5].amount.toLocaleString()}`, sub: "current month" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Analytics & Reports</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Performance, delivery and billing insights for your account</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <Card key={k.label} className="shadow-card border-border/50">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{k.label}</p>
                <p className="text-xl font-semibold text-foreground mt-0.5">{k.value}</p>
                <p className={`text-[10px] mt-0.5 ${k.positive ? "text-green-600 font-semibold" : "text-muted-foreground"}`}>{k.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Average TAT Trend</CardTitle></CardHeader>
            <CardContent className="p-3.5">
              <div className="h-[160px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={tatTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,95%)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" unit=" d" />
                    <Tooltip />
                    <Line type="monotone" dataKey="tat" stroke="hsl(158,64%,28%)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Case Delivery Status</CardTitle></CardHeader>
            <CardContent className="p-3 flex flex-col items-center justify-between">
              <div className="h-[120px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={deliveryStatus} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={2}>
                      {deliveryStatus.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] mt-1.5 w-full">
                {deliveryStatus.map((d) => (
                  <div key={d.name} className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-muted-foreground truncate font-semibold">{d.name} ({d.value})</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Monthly Billing Summary</CardTitle></CardHeader>
            <CardContent className="p-3.5">
              <div className="h-[160px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyBilling}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,95%)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" tickFormatter={(v: any) => `$${v}`} />
                    <Tooltip formatter={(v: any) => `$${v?.toLocaleString()}`} />
                    <Bar dataKey="amount" fill="hsl(152,60%,45%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Case Mix by Type</CardTitle></CardHeader>
            <CardContent className="p-3.5">
              <div className="h-[160px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={typeMix} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,95%)" />
                    <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(158,12%,42%)" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(158,12%,42%)" width={90} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {typeMix.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On-Hold Reasons (last 90 days)</CardTitle></CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              {onHoldReasons.map((r) => (
                <div key={r.reason} className="rounded bg-muted/20 px-3 py-2 border border-border/50">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{r.reason}</p>
                  <p className="text-lg font-semibold text-foreground mt-0.5">{r.count}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
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
                  {invoices.slice(0, 5).map((i) => (
                    <tr key={i.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-3.5 py-1.5 text-[11px] font-semibold text-primary">{i.id}</td>
                      <td className="px-3.5 py-1.5 text-[11px] text-foreground">{i.month}</td>
                      <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground">{i.caseCount}</td>
                      <td className="px-3.5 py-1.5 text-[11px] font-semibold text-foreground">${i.amount.toLocaleString()}</td>
                      <td className="px-3.5 py-1.5">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 scale-95 origin-left">
                          {i.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
