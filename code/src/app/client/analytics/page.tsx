"use client"

import { ClientLayout } from "@/src/components/ClientLayout";
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
    <ClientLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Analytics & Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Performance, delivery and billing insights for your account</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((k) => (
            <Card key={k.label} className="shadow-card">
              <CardContent className="p-5">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-2xl font-semibold text-foreground mt-1">{k.value}</p>
                <p className={`text-xs mt-1 ${k.positive ? "text-green-600 font-medium" : "text-muted-foreground"}`}>{k.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Average TAT Trend</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={tatTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,90%)" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" unit=" d" />
                    <Tooltip />
                    <Line type="monotone" dataKey="tat" stroke="hsl(158,64%,28%)" strokeWidth={2.5} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Case Delivery Status</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-center">
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={deliveryStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" paddingAngle={2}>
                      {deliveryStatus.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-2 w-full">
                {deliveryStatus.map((d) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-muted-foreground truncate">{d.name} ({d.value})</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Monthly Billing Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyBilling}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,90%)" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                    <Bar dataKey="amount" fill="hsl(152,60%,45%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Case Mix by Type</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={typeMix} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(150,18%,90%)" />
                    <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(158,12%,42%)" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(158,12%,42%)" width={130} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {typeMix.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card">
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium">On-Hold Reasons (last 90 days)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {onHoldReasons.map((r) => (
                <div key={r.reason} className="rounded-lg bg-muted/40 px-4 py-3 border border-border/50">
                  <p className="text-xs text-muted-foreground">{r.reason}</p>
                  <p className="text-xl font-semibold text-foreground mt-1">{r.count}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Recent Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="border-b border-border">
                    {["Invoice", "Period", "Cases", "Amount", "Status"].map((h) => (
                      <th key={h} className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.slice(0, 5).map((i) => (
                    <tr key={i.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-6 py-4 font-medium text-primary">{i.id}</td>
                      <td className="px-6 py-4 text-foreground">{i.month}</td>
                      <td className="px-6 py-4 text-muted-foreground">{i.caseCount}</td>
                      <td className="px-6 py-4 font-medium">${i.amount.toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
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
    </ClientLayout>
  );
}
