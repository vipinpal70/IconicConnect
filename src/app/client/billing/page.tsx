"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ClientLayout } from "@/src/components/ClientLayout"
import { fetchProfileWithCache } from "@/src/lib/profile-cache"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog"
import {
  Download,
  FileText,
  CheckCircle,
  Clock,
  DollarSign,
  BadgeCheck,
  CircleCheck,
  CircleX,
} from "lucide-react"
import { toast } from "sonner"
import type { InvoiceWithClient } from "@/src/lib/invoice"

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  iconBg,
}: {
  label: string
  value: React.ReactNode
  icon: React.ReactNode
  iconBg: string
}) {
  return (
    <Card className="shadow-card border-border/50">
      <CardContent className="p-3.5 flex items-center gap-2.5">
        <div className={`p-1.5 rounded shrink-0 ${iconBg}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider truncate">{label}</p>
          <p className="text-lg font-black text-foreground leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Mark-as-Paid confirmation dialog ─────────────────────────────────────────

function MarkPaidDialog({
  invoice,
  open,
  onClose,
  onConfirm,
  loading,
}: {
  invoice: InvoiceWithClient | null
  open: boolean
  onClose: () => void
  onConfirm: () => void
  loading: boolean
}) {
  if (!invoice) return null
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Confirm Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            You are confirming that you have sent payment for:
          </p>
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice</span>
              <span className="font-semibold text-foreground">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Period</span>
              <span className="font-medium">{invoice.startDate} → {invoice.endDate}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5 mt-1">
              <span className="font-semibold">Total</span>
              <span className="font-black text-foreground">${invoice.total.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Today's date will be recorded as the payment date. You can contact support if you need to update this.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading} className="text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={loading}
            className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading ? "Saving…" : "Confirm Payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ClientBillingPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [confirmInvoice, setConfirmInvoice] = useState<InvoiceWithClient | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)

  const handleExportCaseSheet = async (invoiceId: string, invoiceNumber: string) => {
    setExportingId(invoiceId)
    try {
      const res = await fetch(`/api/client/invoices/${invoiceId}/case-sheet`)
      if (!res.ok) { toast.error("Failed to generate case sheet"); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${invoiceNumber}-case-sheet.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Failed to download case sheet")
    } finally {
      setExportingId(null)
    }
  }

  // Sub-users cannot access billing
  useEffect(() => {
    fetchProfileWithCache()
      .then((p) => { if (p?.role === "subuser") router.replace("/client/dashboard") })
      .catch(() => {})
  }, [router])

  const { data: invoiceList = [], isLoading } = useQuery<InvoiceWithClient[]>({
    queryKey: ["clientInvoices"],
    queryFn: async () => {
      const res = await fetch("/api/client/invoices")
      if (!res.ok) throw new Error("Failed to fetch invoices")
      return res.json()
    },
  })

  const markPaidMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/client/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientPaid: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Failed to update invoice")
      }
      return res.json() as Promise<InvoiceWithClient>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<InvoiceWithClient[]>(["clientInvoices"], (prev = []) =>
        prev.map((inv) => (inv.id === updated.id ? updated : inv))
      )
      toast.success(`Invoice ${updated.invoiceNumber} marked as paid`)
      setConfirmInvoice(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ── KPI computations ──────────────────────────────────────────────────────
  const totalSpend = invoiceList.reduce((s, i) => s + i.total, 0)
  const paidCount = invoiceList.filter((i) => i.clientPaid).length
  const pendingCount = invoiceList.filter((i) => !i.clientPaid).length
  const confirmedCount = invoiceList.filter((i) => i.received).length

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in">

        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-foreground">Billing & Invoices</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Your invoice history and payment status</p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Lifetime Spend</p>
              <p className="text-xl font-black text-foreground mt-0.5">
                ${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </CardContent>
          </Card>
          <KpiCard
            label="Paid"
            value={paidCount}
            iconBg="bg-green-100 text-green-700"
            icon={<CheckCircle className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="Pending"
            value={pendingCount}
            iconBg="bg-yellow-100 text-yellow-700"
            icon={<Clock className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="Admin Confirmed"
            value={confirmedCount}
            iconBg="bg-blue-100 text-blue-700"
            icon={<BadgeCheck className="h-3.5 w-3.5" />}
          />
        </div>

        {/* Invoice table */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 border-b border-border">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              All Invoices
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Invoice", "Period", "Items", "Total", "Payment", "Admin Receipt", ""].map((h) => (
                      <th
                        key={h}
                        className="text-left px-3.5 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    [1, 2, 3].map((n) => (
                      <tr key={n}>
                        <td colSpan={7} className="px-3.5 py-4 text-center text-xs text-muted-foreground">
                          Loading…
                        </td>
                      </tr>
                    ))
                  ) : invoiceList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-10 text-center text-xs text-muted-foreground">
                        No invoices yet. Invoices are generated by the Iconic Connect team.
                      </td>
                    </tr>
                  ) : (
                    invoiceList.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/10 transition-colors">

                        {/* Invoice number */}
                        <td className="px-3.5 py-2.5 text-[11px] font-bold text-primary whitespace-nowrap">
                          {inv.invoiceNumber}
                        </td>

                        {/* Period */}
                        <td className="px-3.5 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                          {inv.startDate} → {inv.endDate}
                        </td>

                        {/* Item count */}
                        <td className="px-3.5 py-2.5 text-[11px] text-muted-foreground">
                          {inv.items.length} service{inv.items.length !== 1 ? "s" : ""}
                        </td>

                        {/* Total */}
                        <td className="px-3.5 py-2.5 text-[11px] font-semibold text-foreground whitespace-nowrap">
                          ${inv.total.toFixed(2)}
                        </td>

                        {/* Payment status */}
                        <td className="px-3.5 py-2.5">
                          {inv.clientPaid ? (
                            <div className="flex items-center gap-1.5">
                              <CircleCheck className="h-3.5 w-3.5 text-green-500 shrink-0" />
                              <span className="text-[10px] text-green-600 font-medium whitespace-nowrap">
                                {inv.clientPaymentDate
                                  ? new Date(inv.clientPaymentDate).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })
                                  : "Paid"}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <CircleX className="h-3.5 w-3.5 text-red-400 shrink-0" />
                              <span className="text-[10px] text-red-500 font-medium">Unpaid</span>
                            </div>
                          )}
                        </td>

                        {/* Admin receipt */}
                        <td className="px-3.5 py-2.5">
                          {inv.received ? (
                            <div className="flex items-center gap-1.5">
                              <BadgeCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                              <span className="text-[10px] text-blue-600 font-medium whitespace-nowrap">
                                {inv.receivedOn
                                  ? new Date(inv.receivedOn).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                    })
                                  : "Confirmed"}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Pending</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="View invoice"
                              onClick={() => router.push(`/client/billing/${inv.id}`)}
                            >
                              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Export case sheet"
                              disabled={exportingId === inv.id}
                              onClick={() => handleExportCaseSheet(inv.id, inv.invoiceNumber)}
                            >
                              <Download className={`h-3.5 w-3.5 ${exportingId === inv.id ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
                            </Button>
                            {!inv.clientPaid && (
                              <Button
                                size="sm"
                                className="h-7 text-[10px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                                onClick={() => setConfirmInvoice(inv)}
                              >
                                Mark as Paid
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <MarkPaidDialog
        invoice={confirmInvoice}
        open={!!confirmInvoice}
        onClose={() => setConfirmInvoice(null)}
        onConfirm={() => confirmInvoice && markPaidMutation.mutate(confirmInvoice.id)}
        loading={markPaidMutation.isPending}
      />
    </ClientLayout>
  )
}
