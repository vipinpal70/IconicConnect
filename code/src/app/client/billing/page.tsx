"use client"

import { ClientLayout } from "@/src/components/ClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { invoices, cases } from "@/src/data/demoData";
import { Download, CreditCard, Clock, AlertTriangle, CheckCircle, FileText } from "lucide-react";

const statusColor: Record<string, string> = {
  Paid: "bg-green-100 text-green-700",
  Pending: "bg-yellow-100 text-yellow-700",
  Overdue: "bg-red-100 text-red-700",
  Draft: "bg-gray-100 text-gray-700",
};

export default function BillingPage() {
  const totalSpend = invoices.reduce((s, i) => s + i.amount, 0);
  const paid = invoices.filter((i) => i.status === "Paid").length;
  const pending = invoices.filter((i) => i.status === "Pending").length;
  const overdue = invoices.filter((i) => i.status === "Overdue").length;

  return (
    <ClientLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Billing & Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">Monthly case summaries and auto-generated invoices</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="shadow-card">
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">Lifetime Spend</p>
              <p className="text-2xl font-semibold text-foreground mt-1">${totalSpend.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="shadow-card"><CardContent className="p-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-green-100 text-green-700"><CheckCircle className="h-4 w-4" /></div><div><p className="text-xs text-muted-foreground">Paid</p><p className="text-xl font-semibold">{paid}</p></div></CardContent></Card>
          <Card className="shadow-card"><CardContent className="p-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-yellow-100 text-yellow-700"><Clock className="h-4 w-4" /></div><div><p className="text-xs text-muted-foreground">Pending</p><p className="text-xl font-semibold">{pending}</p></div></CardContent></Card>
          <Card className="shadow-card"><CardContent className="p-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-red-100 text-red-700"><AlertTriangle className="h-4 w-4" /></div><div><p className="text-xs text-muted-foreground">Overdue</p><p className="text-xl font-semibold">{overdue}</p></div></CardContent></Card>
        </div>

        {/* Latest summary card */}
        <Card className="shadow-card border-primary/30">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium">Current Month — May 2024</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Auto-generated case summary attached</p>
            </div>
            <Button>
              <CreditCard className="h-4 w-4 mr-2" /> Pay $1,240
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Case ID", "Type", "Restoration", "Status", "Charge"].map((h) => (
                      <th key={h} className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cases.filter((c) => c.status === "Completed").slice(0, 4).map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-primary font-medium">{c.id}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.caseType}</td>
                      <td className="px-4 py-2">{c.restoration}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.status}</td>
                      <td className="px-4 py-2 font-medium">$18 – $45</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium">All Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Invoice", "Period", "Cases", "Amount", "Status", ""].map((h) => (
                      <th key={h} className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-6 py-4 font-medium text-primary">{inv.id}</td>
                      <td className="px-6 py-4 text-foreground">{inv.month}</td>
                      <td className="px-6 py-4 text-muted-foreground">{inv.caseCount}</td>
                      <td className="px-6 py-4 font-medium">${inv.amount.toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor[inv.status] || "bg-gray-100"}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" title="View summary"><FileText className="h-4 w-4 text-muted-foreground" /></Button>
                        <Button variant="ghost" size="icon" title="Download PDF"><Download className="h-4 w-4 text-muted-foreground" /></Button>
                        {(inv.status === "Pending" || inv.status === "Overdue") && (
                          <Button size="sm">Pay now</Button>
                        )}
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
