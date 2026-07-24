"use client"

import { OpsLayout } from "@/src/components/OpsLayout";
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
    <OpsLayout>
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="text-lg font-bold text-foreground">Billing & Invoices</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Monthly case summaries and auto-generated invoices</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Lifetime Spend</p>
              <p className="text-xl font-black text-foreground mt-0.5">${totalSpend.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="shadow-card border-border/50"><CardContent className="p-3.5 flex items-center gap-3"><div className="p-1.5 rounded bg-green-100 text-green-700"><CheckCircle className="h-4 w-4" /></div><div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Paid</p><p className="text-lg font-black text-foreground mt-0.5">{paid}</p></div></CardContent></Card>
          <Card className="shadow-card border-border/50"><CardContent className="p-3.5 flex items-center gap-3"><div className="p-1.5 rounded bg-yellow-100 text-yellow-700"><Clock className="h-4 w-4" /></div><div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Pending</p><p className="text-lg font-black text-foreground mt-0.5">{pending}</p></div></CardContent></Card>
          <Card className="shadow-card border-border/50"><CardContent className="p-3.5 flex items-center gap-3"><div className="p-1.5 rounded bg-red-100 text-red-700"><AlertTriangle className="h-4 w-4" /></div><div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Overdue</p><p className="text-lg font-black text-foreground mt-0.5">{overdue}</p></div></CardContent></Card>
        </div>

        {/* Latest summary card */}
        <Card className="shadow-card border-primary/30">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Current Month — May 2024</CardTitle>
              <p className="text-[10px] text-muted-foreground mt-0.5">Auto-generated case summary attached</p>
            </div>
            <Button size="sm" className="h-8 text-xs font-semibold">
              <CreditCard className="h-3.5 w-3.5 mr-1.5" /> Pay $1,240
            </Button>
          </CardHeader>
          <CardContent className="p-3.5">
            <div className="rounded border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Case ID", "Type", "Restoration", "Status", "Charge"].map((h) => (
                      <th key={h} className="text-left px-3.5 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cases.filter((c) => c.status === "Completed").slice(0, 4).map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="px-3.5 py-1 text-[11px] text-primary font-bold">{c.id}</td>
                      <td className="px-3.5 py-1 text-[11px] text-muted-foreground">{c.caseType}</td>
                      <td className="px-3.5 py-1 text-[11px] text-foreground">{c.restoration}</td>
                      <td className="px-3.5 py-1 text-[11px] text-muted-foreground">{c.status}</td>
                      <td className="px-3.5 py-1 text-[11px] font-semibold text-foreground">$18 – $45</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50"><CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">All Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Invoice", "Period", "Cases", "Amount", "Status", ""].map((h) => (
                      <th key={h} className="text-left px-3.5 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-3.5 py-1.5 text-[11px] font-bold text-primary">{inv.id}</td>
                      <td className="px-3.5 py-1.5 text-[11px] text-foreground">{inv.month}</td>
                      <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground">{inv.caseCount}</td>
                      <td className="px-3.5 py-1.5 text-[11px] font-semibold text-foreground">${inv.amount.toLocaleString()}</td>
                      <td className="px-3.5 py-1.5">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold scale-95 origin-left ${statusColor[inv.status] || "bg-gray-100"}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-3.5 py-1.5 text-right whitespace-nowrap">
                        <div className="flex gap-0.5 items-center justify-end">
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="View summary"><FileText className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Download PDF"><Download className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                          {(inv.status === "Pending" || inv.status === "Overdue") && (
                            <Button size="sm" className="h-6 text-[10px] font-bold py-0 px-2 ml-1">Pay now</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </OpsLayout>
  );
}
