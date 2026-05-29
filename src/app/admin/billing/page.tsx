"use client"

import { useState } from "react";
import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { invoices } from "@/src/data/demoData";
import { Download, Clock, AlertTriangle, CheckCircle, FileText, Receipt } from "lucide-react";
import { toast } from "sonner";

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

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateBill = async () => {
    if (!startDate || !endDate) {
      toast.error("Please select both a start and end date.");
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      toast.error("Start date must be before end date.");
      return;
    }
    setIsGenerating(true);
    try {
      // TODO: wire to real API — POST /api/admin/billing/generate { startDate, endDate }
      await new Promise((r) => setTimeout(r, 1200));
      toast.success(`Bill generated for ${startDate} → ${endDate}`);
    } catch {
      toast.error("Failed to generate bill. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Billing & Invoices</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Monthly case summaries and auto-generated invoices</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Lifetime Spend</p>
              <p className="text-xl font-semibold text-foreground mt-0.5">${totalSpend.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="shadow-card border-border/50"><CardContent className="p-3.5 flex items-center gap-2.5"><div className="p-1.5 rounded bg-green-100 text-green-700"><CheckCircle className="h-3.5 w-3.5" /></div><div><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Paid</p><p className="text-lg font-semibold text-foreground">{paid}</p></div></CardContent></Card>
          <Card className="shadow-card border-border/50"><CardContent className="p-3.5 flex items-center gap-2.5"><div className="p-1.5 rounded bg-yellow-100 text-yellow-700"><Clock className="h-3.5 w-3.5" /></div><div><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pending</p><p className="text-lg font-semibold text-foreground">{pending}</p></div></CardContent></Card>
          <Card className="shadow-card border-border/50"><CardContent className="p-3.5 flex items-center gap-2.5"><div className="p-1.5 rounded bg-red-100 text-red-700"><AlertTriangle className="h-3.5 w-3.5" /></div><div><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Overdue</p><p className="text-lg font-semibold text-foreground">{overdue}</p></div></CardContent></Card>
        </div>

        {/* Generate Bill Card */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generate Bill</CardTitle>
            <p className="text-[10px] text-muted-foreground mt-0.5">Select a date range to generate a bill for all completed cases in that period</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button
                onClick={handleGenerateBill}
                disabled={isGenerating}
                className="h-8 text-xs px-4 shrink-0"
              >
                <Receipt className="h-3.5 w-3.5 mr-1.5" />
                {isGenerating ? "Generating..." : "Generate Bill"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Invoice", "Period", "Cases", "Amount", "Status", ""].map((h) => (
                      <th key={h} className="text-left px-3.5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-3.5 py-2 text-[11px] font-semibold text-primary">{inv.id}</td>
                      <td className="px-3.5 py-2 text-[11px] text-foreground">{inv.month}</td>
                      <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{inv.caseCount}</td>
                      <td className="px-3.5 py-2 text-[11px] font-semibold text-foreground">${inv.amount.toLocaleString()}</td>
                      <td className="px-3.5 py-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold scale-95 origin-left inline-flex ${statusColor[inv.status] || "bg-gray-100"}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-3.5 py-2 flex gap-1 justify-end items-center">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="View summary"><FileText className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Download PDF"><Download className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                        {(inv.status === "Pending" || inv.status === "Overdue") && (
                          <Button size="sm" className="h-7 text-[10px] px-2.5">Pay now</Button>
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
    </AdminLayout>
  );
}
