"use client"

import { useParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { ClientLayout } from "@/src/components/ClientLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { ArrowLeft, BadgeCheck, CircleCheck, CircleX, Printer } from "lucide-react"
import { toast } from "sonner"
import type { InvoiceWithClient } from "@/src/lib/invoice"

export default function ClientInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: inv, isLoading, error } = useQuery<InvoiceWithClient>({
    queryKey: ["clientInvoice", id],
    queryFn: async () => {
      const res = await fetch(`/api/client/invoices/${id}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Failed to fetch invoice")
      }
      return res.json()
    },
  })

  const markPaidMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/client/invoices/${id}`, {
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
      queryClient.setQueryData(["clientInvoice", id], updated)
      queryClient.invalidateQueries({ queryKey: ["clientInvoices"] })
      toast.success("Invoice marked as paid")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <ClientLayout>
        <div className="flex h-[60vh] items-center justify-center text-xs text-muted-foreground">
          Loading invoice…
        </div>
      </ClientLayout>
    )
  }

  if (error || !inv) {
    return (
      <ClientLayout>
        <div className="flex h-[60vh] items-center justify-center text-xs text-red-500">
          {(error as Error | undefined)?.message ?? "Invoice not found"}
        </div>
      </ClientLayout>
    )
  }

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in max-w-3xl mx-auto">

        {/* Back + header */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/client/billing")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-foreground leading-none">{inv.invoiceNumber}</h1>
            <p className="text-xs text-muted-foreground mt-1">{inv.startDate} → {inv.endDate}</p>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 print:hidden"
            onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </div>

        {/* Payment status cards */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5 space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Your Payment</p>
              {inv.clientPaid ? (
                <div className="flex items-center gap-2">
                  <CircleCheck className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-sm font-semibold text-green-700">Paid</p>
                    {inv.clientPaymentDate && (
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(inv.clientPaymentDate).toLocaleDateString("en-US", {
                          month: "long", day: "numeric", year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CircleX className="h-5 w-5 text-red-400" />
                    <p className="text-sm font-semibold text-red-600">Unpaid</p>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-[10px] w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={markPaidMutation.isPending}
                    onClick={() => markPaidMutation.mutate()}
                  >
                    {markPaidMutation.isPending ? "Saving…" : "Mark as Paid"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5 space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Admin Receipt</p>
              {inv.received ? (
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-sm font-semibold text-blue-700">Confirmed</p>
                    {inv.receivedOn && (
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(inv.receivedOn).toLocaleDateString("en-US", {
                          month: "long", day: "numeric", year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  </div>
                  <p className="text-sm text-muted-foreground">Awaiting confirmation</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Invoice detail */}
        <Card className="shadow-card border-border/50" id="invoice-print">
          <CardHeader className="py-3 px-4 border-b border-border bg-[#8FA8A5] rounded-t-xl">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-white tracking-wide">Commercial Invoice</CardTitle>
              <span className="text-white/90 font-black text-sm tracking-widest">
                i<span className="text-white">NVERT</span>
                <span className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-white text-[8px] font-black">A</span>
                CS
              </span>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Date / Invoice no */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#F2F6F5] border-b border-border text-xs">
              <span className="text-muted-foreground">
                Date: <span className="font-semibold text-foreground">{new Date(inv.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
              </span>
              <span className="text-muted-foreground">
                Invoice No: <span className="font-semibold text-foreground">{inv.invoiceNumber}</span>
              </span>
            </div>

            {/* Ship from / to */}
            <div className="grid grid-cols-2 gap-0 border-b border-border">
              <div className="px-4 py-3 space-y-0.5 border-r border-border">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Shipped By</p>
                <p className="text-xs font-semibold text-foreground">Iconic Dental Pvt. Ltd.</p>
                <p className="text-[11px] text-muted-foreground">4th Floor 637 Block B1 Janak Puri ND-58</p>
                <p className="text-[11px] text-muted-foreground">1-647-802-8420</p>
                <p className="text-[11px] text-muted-foreground">Info@theiconicdental.com</p>
              </div>
              <div className="px-4 py-3 space-y-0.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Shipped To</p>
                <p className="text-xs font-semibold text-foreground">{inv.clientLabName || inv.clientName}</p>
                {inv.clientCity && <p className="text-[11px] text-muted-foreground">{inv.clientCity}{inv.clientState ? `, ${inv.clientState}` : ""}{inv.clientPostalCode ? ` ${inv.clientPostalCode}` : ""}</p>}
                {inv.clientPhone && <p className="text-[11px] text-muted-foreground">{inv.clientPhone}</p>}
                <p className="text-[11px] text-muted-foreground">{inv.clientEmail}</p>
              </div>
            </div>

            {/* Country rows */}
            <div className="grid grid-cols-2 border-b border-border">
              <div className="px-4 py-2 border-r border-border">
                <span className="text-[10px] text-muted-foreground">Country of Origin: </span>
                <span className="text-[10px] font-semibold text-foreground">India</span>
              </div>
              <div className="px-4 py-2">
                <span className="text-[10px] text-muted-foreground">Country of Destination: </span>
                <span className="text-[10px] font-semibold text-foreground">{inv.clientCountry || "—"}</span>
              </div>
            </div>

            {/* Items table */}
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#8FA8A5] text-white">
                  <th className="px-3.5 py-2 text-left font-semibold text-[10px] uppercase tracking-wider w-10">S.No</th>
                  <th className="px-3.5 py-2 text-left font-semibold text-[10px] uppercase tracking-wider">Description</th>
                  <th className="px-3.5 py-2 text-center font-semibold text-[10px] uppercase tracking-wider w-16">Qty</th>
                  <th className="px-3.5 py-2 text-right font-semibold text-[10px] uppercase tracking-wider w-24">Unit Price</th>
                  <th className="px-3.5 py-2 text-right font-semibold text-[10px] uppercase tracking-wider w-24">Total</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-[#F2F6F5]"}>
                    <td className="px-3.5 py-2 text-muted-foreground">{item.sno}</td>
                    <td className="px-3.5 py-2 text-foreground">{item.description}</td>
                    <td className="px-3.5 py-2 text-center text-foreground">{item.qty}</td>
                    <td className="px-3.5 py-2 text-right text-foreground">${item.unitPrice.toFixed(2)}</td>
                    <td className="px-3.5 py-2 text-right font-semibold text-foreground">${item.totalPrice.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals footer */}
            <div className="border-t border-border">
              {inv.remarks && (
                <div className="flex justify-between px-4 py-2 bg-[#EEF4F3] border-b border-border text-xs">
                  <span className="text-muted-foreground font-medium">Remarks</span>
                  <span className="text-foreground">{inv.remarks}</span>
                </div>
              )}
              {inv.termsOfPayment && (
                <div className="flex justify-between px-4 py-2 bg-[#EEF4F3] border-b border-border text-xs">
                  <span className="text-muted-foreground font-medium">Terms of Payment</span>
                  <span className="text-foreground">{inv.termsOfPayment}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-2 border-b border-border text-xs">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium text-foreground">${inv.subtotal.toFixed(2)}</span>
              </div>
              {inv.taxAmount > 0 && (
                <div className="flex justify-between px-4 py-2 border-b border-border text-xs">
                  <span className="text-muted-foreground">
                    Tax{inv.taxType === "percent" ? ` (${inv.taxValue}%)` : ""}
                  </span>
                  <span className="text-green-600 font-medium">+${inv.taxAmount.toFixed(2)}</span>
                </div>
              )}
              {inv.discountAmount > 0 && (
                <div className="flex justify-between px-4 py-2 border-b border-border text-xs">
                  <span className="text-muted-foreground">
                    Discount{inv.discountType === "percent" ? ` (${inv.discountValue}%)` : ""}
                  </span>
                  <span className="text-red-500 font-medium">-${inv.discountAmount.toFixed(2)}</span>
                </div>
              )}
              {inv.extraChargesAmount > 0 && (
                <div className="flex justify-between px-4 py-2 border-b border-border text-xs">
                  <span className="text-muted-foreground">
                    Extra Charges{inv.extraChargesType === "percent" ? ` (${inv.extraChargesValue}%)` : ""}
                  </span>
                  <span className="text-green-600 font-medium">+${inv.extraChargesAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-3 bg-[#EEF4F3] text-sm font-bold">
                <span className="text-foreground">Total</span>
                <span className="text-foreground">${inv.total.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ClientLayout>
  )
}
