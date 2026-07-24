"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import {
  ArrowLeft, Printer, CheckCircle, Clock, Save, Pencil,
  CircleCheck, CircleX, BadgeCheck, Banknote, CalendarDays,
} from "lucide-react"
import { toast } from "sonner"
import type { InvoiceWithClient } from "@/src/lib/invoice"
import type { AdjustmentType } from "@/src/db/schema/invoice"

// ── Sender details ──────────────────────────────────────────────────────────

const SENDER = {
  company: "Iconic Dental Pvt. Ltd.",
  address: "4th Floor, 637, Block B1, Janak Puri, ND-58",
  phone: "1-647-802-8420",
  email: "Info@theiconicdental.com",
  country: "India",
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function computeAdj(subtotal: number, value: number, type: string): number {
  if (!value || value <= 0) return 0
  return type === "percent"
    ? parseFloat(((subtotal * value) / 100).toFixed(2))
    : value
}

function adjLabel(label: string, value: number, type: string): string {
  if (!value || value <= 0) return label
  return type === "percent" ? `${label} (${value}%)` : label
}

type AdjType = "percent" | "fixed"

// ── AdjRow ───────────────────────────────────────────────────────────────────

function AdjRow({
  label, value, type, subtotal, onChange, sign,
}: {
  label: string; value: string; type: AdjType; subtotal: number
  onChange: (val: string, t: AdjType) => void; sign: "+" | "-"
}) {
  const amount = computeAdj(subtotal, parseFloat(value) || 0, type)
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-[11px] text-muted-foreground shrink-0">{label}</span>
      <Input type="number" min="0" step="0.01" value={value}
        onChange={e => onChange(e.target.value, type)} className="h-7 text-xs w-20" />
      <div className="flex border border-border rounded overflow-hidden text-[10px] font-semibold h-7">
        <button type="button" onClick={() => onChange(value, "percent")}
          className={`px-2 ${type === "percent" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>%</button>
        <button type="button" onClick={() => onChange(value, "fixed")}
          className={`px-2 ${type === "fixed" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>$</button>
      </div>
      {amount > 0
        ? <span className={`text-[11px] font-medium ml-auto ${sign === "-" ? "text-red-500" : "text-green-600"}`}>{sign}${amount.toFixed(2)}</span>
        : <span className="text-[11px] text-muted-foreground ml-auto">—</span>}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const invoiceId = Array.isArray(params?.id) ? params.id[0] : params?.id

  const [invoice, setInvoice] = useState<InvoiceWithClient | null>(null)
  const [loading, setLoading] = useState(true)

  // Adjustment editing
  const [showAdjEdit, setShowAdjEdit] = useState(false)
  const [savingAdj, setSavingAdj] = useState(false)
  const [adjEdit, setAdjEdit] = useState({
    taxValue: "", taxType: "percent" as AdjType,
    discountValue: "", discountType: "percent" as AdjType,
    extraChargesValue: "", extraChargesType: "percent" as AdjType,
  })

  // Client payment
  const [markingPaid, setMarkingPaid] = useState(false)

  // Admin receipt confirmation
  const [showReceiveForm, setShowReceiveForm] = useState(false)
  const [confirmationId, setConfirmationId] = useState("")
  const [receivedOnDate, setReceivedOnDate] = useState(
    new Date().toISOString().split("T")[0]
  )
  const [savingReceived, setSavingReceived] = useState(false)

  const load = useCallback(async () => {
    if (!invoiceId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/invoices/${invoiceId}`)
      if (!res.ok) throw new Error("Invoice not found")
      const data: InvoiceWithClient = await res.json()
      setInvoice(data)
      setAdjEdit({
        taxValue: data.taxValue > 0 ? String(data.taxValue) : "",
        taxType: data.taxType as AdjType,
        discountValue: data.discountValue > 0 ? String(data.discountValue) : "",
        discountType: data.discountType as AdjType,
        extraChargesValue: data.extraChargesValue > 0 ? String(data.extraChargesValue) : "",
        extraChargesType: data.extraChargesType as AdjType,
      })
    } catch { toast.error("Failed to load invoice") }
    finally { setLoading(false) }
  }, [invoiceId])

  useEffect(() => { load() }, [load])

  // ── PATCH helper ────────────────────────────────────────────────────────

  async function patch(body: Record<string, unknown>): Promise<InvoiceWithClient | null> {
    const res = await fetch(`/api/admin/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
    return res.json()
  }

  // ── Toggle overall status (pending/paid) ─────────────────────────────────

  const handleToggleStatus = async () => {
    if (!invoice) return
    try {
      const updated = await patch({ status: invoice.status === "paid" ? "pending" : "paid" })
      if (updated) { setInvoice(updated); toast.success(`Marked as ${updated.status}`) }
    } catch { toast.error("Failed to update status") }
  }

  // ── Toggle client paid ───────────────────────────────────────────────────

  const handleToggleClientPaid = async () => {
    if (!invoice) return
    setMarkingPaid(true)
    try {
      const newVal = !invoice.clientPaid
      const updated = await patch({
        clientPaid: newVal,
        ...(newVal ? { clientPaymentDate: new Date().toISOString().split("T")[0] } : {}),
      })
      if (updated) {
        setInvoice(updated)
        toast.success(newVal ? "Client marked as paid" : "Client payment cleared")
      }
    } catch { toast.error("Failed to update client payment") }
    finally { setMarkingPaid(false) }
  }

  // ── Save adjustments ─────────────────────────────────────────────────────

  const handleSaveAdj = async () => {
    if (!invoice) return
    setSavingAdj(true)
    try {
      const updated = await patch({
        taxType: adjEdit.taxType, taxValue: parseFloat(adjEdit.taxValue) || 0,
        discountType: adjEdit.discountType, discountValue: parseFloat(adjEdit.discountValue) || 0,
        extraChargesType: adjEdit.extraChargesType, extraChargesValue: parseFloat(adjEdit.extraChargesValue) || 0,
      })
      if (updated) { setInvoice(updated); setShowAdjEdit(false); toast.success("Adjustments updated") }
    } catch { toast.error("Failed to save adjustments") }
    finally { setSavingAdj(false) }
  }

  // ── Confirm received ─────────────────────────────────────────────────────

  const handleConfirmReceived = async () => {
    setSavingReceived(true)
    try {
      const updated = await patch({
        received: true,
        receivedConfirmationId: confirmationId || null,
        receivedOn: receivedOnDate,
      })
      if (updated) {
        setInvoice(updated); setShowReceiveForm(false)
        toast.success("Payment receipt confirmed")
      }
    } catch { toast.error("Failed to confirm receipt") }
    finally { setSavingReceived(false) }
  }

  const handleUndoReceived = async () => {
    try {
      const updated = await patch({ received: false })
      if (updated) { setInvoice(updated); toast.success("Receipt confirmation cleared") }
    } catch { toast.error("Failed to update") }
  }

  // ── States ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64 text-xs text-muted-foreground">Loading invoice…</div>
      </AdminLayout>
    )
  }
  if (!invoice) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-sm text-muted-foreground">Invoice not found</p>
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
          </Button>
        </div>
      </AdminLayout>
    )
  }

  const invoiceDate = new Date(invoice.createdAt).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
  const clientAddress = [invoice.clientCity, invoice.clientState, invoice.clientPostalCode, invoice.clientCountry].filter(Boolean).join(", ")

  const subtotal = invoice.subtotal
  const prevTax = computeAdj(subtotal, parseFloat(adjEdit.taxValue) || 0, adjEdit.taxType)
  const prevDiscount = computeAdj(subtotal, parseFloat(adjEdit.discountValue) || 0, adjEdit.discountType)
  const prevExtra = computeAdj(subtotal, parseFloat(adjEdit.extraChargesValue) || 0, adjEdit.extraChargesType)
  const prevTotal = parseFloat((subtotal + prevTax - prevDiscount + prevExtra).toFixed(2))

  return (
    <AdminLayout>
      <div className="space-y-4 max-w-4xl mx-auto">

        {/* ── Action bar ── */}
        <div className="flex flex-wrap justify-between items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => router.push("/admin/billing")} className="h-8 text-xs gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" />Back to Billing
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAdjEdit(v => !v)} className="h-8 text-xs gap-1.5">
              <Pencil className="h-3.5 w-3.5" />Edit Adjustments
            </Button>
            <Button variant={invoice.status === "paid" ? "outline" : "default"} size="sm"
              onClick={handleToggleStatus} className="h-8 text-xs gap-1.5">
              {invoice.status === "paid"
                ? <><Clock className="h-3.5 w-3.5" />Mark Pending</>
                : <><CheckCircle className="h-3.5 w-3.5" />Mark Paid</>}
            </Button>
            <Button size="sm" onClick={() => window.print()} className="h-8 text-xs gap-1.5">
              <Printer className="h-3.5 w-3.5" />Print / PDF
            </Button>
          </div>
        </div>

        {/* ── Payment tracking panel (hidden on print) ── */}
        <div className="print:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Client Payment card */}
          <div className={`rounded-lg border p-4 space-y-3 ${invoice.clientPaid ? "border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800" : "border-border bg-card"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {invoice.clientPaid
                  ? <CircleCheck className="h-4.5 w-4.5 text-green-500" />
                  : <CircleX className="h-4.5 w-4.5 text-red-400" />}
                <span className="text-xs font-semibold text-foreground">Client Payment</span>
              </div>
              <Button
                size="sm"
                variant={invoice.clientPaid ? "outline" : "default"}
                onClick={handleToggleClientPaid}
                disabled={markingPaid}
                className="h-7 text-[11px] px-3 gap-1"
              >
                <Banknote className="h-3 w-3" />
                {invoice.clientPaid ? "Mark Unpaid" : "Mark as Paid"}
              </Button>
            </div>
            {invoice.clientPaid && invoice.clientPaymentDate ? (
              <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                <CalendarDays className="h-3.5 w-3.5" />
                Paid on{" "}
                <strong>
                  {new Date(invoice.clientPaymentDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </strong>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No payment recorded yet.</p>
            )}
          </div>

          {/* Admin Receipt card */}
          <div className={`rounded-lg border p-4 space-y-3 ${invoice.received ? "border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800" : "border-border bg-card"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {invoice.received
                  ? <BadgeCheck className="h-4.5 w-4.5 text-blue-500" />
                  : <Clock className="h-4.5 w-4.5 text-muted-foreground" />}
                <span className="text-xs font-semibold text-foreground">Admin Receipt</span>
              </div>
              {!invoice.received ? (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setShowReceiveForm(v => !v)}
                  disabled={!invoice.clientPaid}
                  title={!invoice.clientPaid ? "Mark client as paid first" : undefined}
                  className="h-7 text-[11px] px-3 gap-1"
                >
                  <BadgeCheck className="h-3 w-3" />Confirm Received
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={handleUndoReceived} className="h-7 text-[11px] px-2 text-muted-foreground">
                  Undo
                </Button>
              )}
            </div>

            {invoice.received ? (
              <div className="space-y-1 text-xs text-blue-700 dark:text-blue-400">
                {invoice.receivedOn && (
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Received on{" "}
                    <strong>
                      {new Date(invoice.receivedOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </strong>
                  </div>
                )}
                {invoice.receivedConfirmationId && (
                  <p className="font-mono text-[11px] text-blue-600">
                    Ref: {invoice.receivedConfirmationId}
                  </p>
                )}
              </div>
            ) : !invoice.clientPaid ? (
              <p className="text-xs text-muted-foreground">Waiting for client payment first.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Click "Confirm Received" once money is in hand.</p>
            )}

            {/* Inline receive form */}
            {showReceiveForm && !invoice.received && (
              <div className="pt-2 border-t border-border space-y-2 animate-fade-in">
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Confirmation / Reference ID
                  </Label>
                  <Input
                    value={confirmationId}
                    onChange={e => setConfirmationId(e.target.value)}
                    placeholder="e.g. TXN-123456 (optional)"
                    className="h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Received On
                  </Label>
                  <Input
                    type="date"
                    value={receivedOnDate}
                    onChange={e => setReceivedOnDate(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setShowReceiveForm(false)} className="h-7 text-xs">
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleConfirmReceived} disabled={savingReceived} className="h-7 text-xs gap-1">
                    <Save className="h-3 w-3" />
                    {savingReceived ? "Saving…" : "Confirm"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Adjustments editor ── */}
        {showAdjEdit && (
          <div className="print:hidden border border-border rounded-lg p-4 bg-card space-y-3 animate-fade-in">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Edit Adjustments</p>
            <div className="space-y-2">
              <AdjRow label="Tax" value={adjEdit.taxValue} type={adjEdit.taxType} subtotal={subtotal}
                onChange={(v, t) => setAdjEdit(a => ({ ...a, taxValue: v, taxType: t }))} sign="+" />
              <AdjRow label="Discount" value={adjEdit.discountValue} type={adjEdit.discountType} subtotal={subtotal}
                onChange={(v, t) => setAdjEdit(a => ({ ...a, discountValue: v, discountType: t }))} sign="-" />
              <AdjRow label="Extra Charges" value={adjEdit.extraChargesValue} type={adjEdit.extraChargesType} subtotal={subtotal}
                onChange={(v, t) => setAdjEdit(a => ({ ...a, extraChargesValue: v, extraChargesType: t }))} sign="+" />
            </div>
            <div className="border-t border-border pt-3 space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
              {prevTax > 0 && <div className="flex justify-between text-muted-foreground"><span>{adjEdit.taxType === "percent" ? `Tax (${adjEdit.taxValue}%)` : "Tax"}</span><span className="text-green-600">+${fmt(prevTax)}</span></div>}
              {prevDiscount > 0 && <div className="flex justify-between text-muted-foreground"><span>{adjEdit.discountType === "percent" ? `Discount (${adjEdit.discountValue}%)` : "Discount"}</span><span className="text-red-500">-${fmt(prevDiscount)}</span></div>}
              {prevExtra > 0 && <div className="flex justify-between text-muted-foreground"><span>{adjEdit.extraChargesType === "percent" ? `Extra Charges (${adjEdit.extraChargesValue}%)` : "Extra Charges"}</span><span className="text-green-600">+${fmt(prevExtra)}</span></div>}
              <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1"><span>New Total</span><span>${fmt(prevTotal)}</span></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowAdjEdit(false)} className="h-7 text-xs">Cancel</Button>
              <Button size="sm" onClick={handleSaveAdj} disabled={savingAdj} className="h-7 text-xs gap-1">
                <Save className="h-3 w-3" />{savingAdj ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════
            COMMERCIAL INVOICE PDF
        ══════════════════════════════════════════════════ */}
        <div id="invoice-print" className="bg-white text-gray-900 shadow-lg rounded-lg overflow-hidden"
          style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>

          {/* Header */}
          <div className="bg-[#8FA8A5] px-10 pt-8 pb-6 flex justify-between items-end">
            <div>
              <h1 className="text-[42px] font-black text-[#1A3333] leading-none tracking-tight">Commercial</h1>
              <h1 className="text-[42px] font-black text-[#1A3333] leading-none tracking-tight">Invoice</h1>
            </div>
            <div className="text-right pb-1">
              <span className="text-[22px] font-black tracking-[0.22em] text-[#1A3333] uppercase">
                iNV<span className="inline-block -scale-x-100">E</span>RT&#9650;CS
              </span>
            </div>
          </div>

          {/* Date + Invoice No */}
          <div className="bg-[#F2F6F5] px-10 py-3 flex justify-between text-sm border-b border-gray-300">
            <span className="text-gray-600">Date: <strong className="text-gray-900">{invoiceDate}</strong></span>
            <span className="text-gray-600">Invoice No: <strong className="text-gray-900">{invoice.invoiceNumber}</strong></span>
          </div>

          {/* Shipped By / To */}
          <div className="px-10 py-6 grid grid-cols-2 gap-10 border-b border-gray-200">
            <div>
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Shipped By:</p>
              <p className="text-sm font-bold text-gray-900">{SENDER.company}</p>
              <p className="text-sm text-gray-600 mt-1">{SENDER.address}</p>
              <p className="text-sm text-gray-600">{SENDER.phone}</p>
              <p className="text-sm text-gray-600">{SENDER.email}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Shipped To:</p>
              <p className="text-sm font-bold text-gray-900">{invoice.clientLabName || invoice.clientName || invoice.clientEmail}</p>
              {clientAddress && <p className="text-sm text-gray-600 mt-1">{clientAddress}</p>}
              {invoice.clientPhone && <p className="text-sm text-gray-600">{invoice.clientPhone}</p>}
              <p className="text-sm text-gray-600">{invoice.clientEmail}</p>
            </div>
          </div>

          {/* Country + Terms */}
          <div className="px-10 py-2.5 grid grid-cols-2 gap-10 border-b border-gray-200 bg-[#F9FBFB]">
            <p className="text-sm text-gray-700">Country of Origin: <span className="text-gray-900">{SENDER.country}</span></p>
            <p className="text-sm text-gray-700">Country of Destination: <span className="text-gray-900">{invoice.clientCountry || "—"}</span></p>
          </div>
          <div className="px-10 py-2.5 grid grid-cols-2 gap-10 border-b border-gray-300 bg-[#F9FBFB]">
            <p className="text-sm text-gray-700">Country of Manufacture: <span className="text-gray-900">N/A</span></p>
            <p className="text-sm text-gray-700">Terms of Payment: <span className="text-gray-900">{invoice.termsOfPayment ?? "7 Days"}</span></p>
          </div>

          {/* Items table */}
          <div className="px-10 pt-4 pb-0">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#8FA8A5]">
                  <th className="text-left px-4 py-3 text-[13px] font-bold text-[#1A3333] w-16">S.NO</th>
                  <th className="text-left px-4 py-3 text-[13px] font-bold text-[#1A3333]">Item Description</th>
                  <th className="text-center px-4 py-3 text-[13px] font-bold text-[#1A3333] w-20">Qty.</th>
                  <th className="text-right px-4 py-3 text-[13px] font-bold text-[#1A3333] w-28">Unit Price ($)</th>
                  <th className="text-right px-4 py-3 text-[13px] font-bold text-[#1A3333] w-28">Total Price ($)</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-200"
                    style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#F9FBFB" }}>
                    <td className="px-4 py-3 text-gray-700">{item.sno}</td>
                    <td className="px-4 py-3 text-gray-700">{item.description}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{item.qty}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{item.unitPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{item.totalPrice.toFixed(2)}</td>
                  </tr>
                ))}
                {invoice.items.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">No line items</td></tr>
                )}
              </tbody>

              <tfoot>
                {/* Remarks + Subtotal */}
                <tr className="bg-[#EEF4F3] border-t-2 border-[#8FA8A5]">
                  <td colSpan={2} className="px-4 py-3 text-sm font-bold text-gray-800">Remarks</td>
                  <td colSpan={2} className="px-4 py-3 text-right text-sm text-gray-600">Subtotal</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-800 font-medium">{fmt(invoice.subtotal)}</td>
                </tr>
                {invoice.remarks && (
                  <tr className="bg-white">
                    <td colSpan={2} className="px-4 py-2 text-xs text-gray-600 italic">{invoice.remarks}</td>
                    <td colSpan={3} />
                  </tr>
                )}

                {/* Tax */}
                <tr className="bg-white border-t border-gray-200">
                  <td colSpan={3} />
                  <td className="px-4 py-2 text-right text-sm text-gray-600">
                    {adjLabel("Tax", invoice.taxValue, invoice.taxType)}
                  </td>
                  <td className="px-4 py-2 text-right text-sm text-gray-700">
                    {invoice.taxAmount > 0 ? `+${fmt(invoice.taxAmount)}` : "-"}
                  </td>
                </tr>

                {/* Discount */}
                <tr className="bg-[#F9FBFB] border-t border-gray-200">
                  <td colSpan={3} />
                  <td className="px-4 py-2 text-right text-sm text-gray-600">
                    {adjLabel("Discount", invoice.discountValue, invoice.discountType)}
                  </td>
                  <td className="px-4 py-2 text-right text-sm text-gray-700">
                    {invoice.discountAmount > 0 ? `-${fmt(invoice.discountAmount)}` : "-"}
                  </td>
                </tr>

                {/* Extra Charges */}
                <tr className="bg-white border-t border-gray-200">
                  <td colSpan={3} />
                  <td className="px-4 py-2 text-right text-sm text-gray-600">
                    {adjLabel("Extra Charges", invoice.extraChargesValue, invoice.extraChargesType)}
                  </td>
                  <td className="px-4 py-2 text-right text-sm text-gray-700">
                    {invoice.extraChargesAmount > 0 ? `+${fmt(invoice.extraChargesAmount)}` : "-"}
                  </td>
                </tr>

                {/* Total */}
                <tr className="bg-[#EEF4F3] border-t-2 border-[#8FA8A5]">
                  <td colSpan={3} />
                  <td className="px-4 py-3 text-right text-sm font-bold text-[#1A3333]">Total</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-[#1A3333]">{fmt(invoice.total)}</td>
                </tr>

                {/* Payment status row (print only) */}
                <tr className="bg-white border-t border-gray-200">
                  <td colSpan={5} className="px-4 py-3 text-xs text-gray-500">
                    {invoice.clientPaid && invoice.clientPaymentDate
                      ? `Payment received from client on ${new Date(invoice.clientPaymentDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
                      : "Payment pending."}
                    {invoice.received && invoice.receivedConfirmationId
                      ? ` Confirmation Ref: ${invoice.receivedConfirmationId}.`
                      : ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Page 2: Declaration */}
          <div className="border-t-4 border-dashed border-gray-300 mx-10 mt-4 print:border-none print:page-break-before" />
          <div className="px-10 py-8 bg-white">
            <p className="text-sm text-gray-700 mb-6">I declare all the information in this invoice to be true and correct.</p>
            <p className="text-sm font-semibold text-gray-900 mb-1">Sagar Suri</p>
            <p className="text-sm text-gray-600">Director, Invertics Dental Pvt. Ltd a.k.a Iconic Dental</p>
            <div className="mt-6 border-b border-gray-400 w-48" />
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print, #invoice-print * { visibility: visible; }
          #invoice-print { position: fixed; top: 0; left: 0; width: 100%; box-shadow: none; border-radius: 0; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </AdminLayout>
  )
}
