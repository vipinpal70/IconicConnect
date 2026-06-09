"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu"
import {
  CheckCircle,
  Clock,
  FileText,
  Receipt,
  ChevronDown,
  Users,
  Plus,
  X,
  DollarSign,
  Download,
  CircleCheck,
  CircleX,
  BadgeCheck,
} from "lucide-react"
import { toast } from "sonner"
import type { InvoiceWithClient } from "@/src/lib/invoice"

// ── Types ────────────────────────────────────────────────────────────────────

interface ClientProfile {
  id: string
  fullName: string | null
  labName: string | null
  email: string
}

interface CandidateCase {
  id: string
  caseNumber: string | null
  category: string | null
  subTypeData: any
  status: string
  createdAt: string
  price: number
}

type AdjType = "percent" | "fixed"

interface Adjustments {
  taxType: AdjType
  taxValue: string
  discountType: AdjType
  discountValue: string
  extraChargesType: AdjType
  extraChargesValue: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcAdj(subtotal: number, value: string, type: AdjType): number {
  const n = parseFloat(value) || 0
  if (n <= 0) return 0
  return type === "percent" ? parseFloat(((subtotal * n) / 100).toFixed(2)) : n
}

function calcTotal(subtotal: number, adj: Adjustments): number {
  const tax = calcAdj(subtotal, adj.taxValue, adj.taxType)
  const discount = calcAdj(subtotal, adj.discountValue, adj.discountType)
  const extra = calcAdj(subtotal, adj.extraChargesValue, adj.extraChargesType)
  return parseFloat((subtotal + tax - discount + extra).toFixed(2))
}

// ── AdjustmentRow ─────────────────────────────────────────────────────────────

function AdjRow({
  label, value, type, subtotal, onValue, onType, sign,
}: {
  label: string; value: string; type: AdjType; subtotal: number
  onValue: (v: string) => void; onType: (t: AdjType) => void; sign: "+" | "-"
}) {
  const amount = calcAdj(subtotal, value, type)
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-[11px] text-muted-foreground shrink-0">{label}</span>
      <Input type="number" min="0" step="0.01" placeholder="0" value={value}
        onChange={(e) => onValue(e.target.value)} className="h-7 text-xs w-20" />
      <div className="flex border border-border rounded overflow-hidden text-[10px] font-semibold h-7">
        <button type="button" onClick={() => onType("percent")}
          className={`px-2 transition-colors ${type === "percent" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>%</button>
        <button type="button" onClick={() => onType("fixed")}
          className={`px-2 transition-colors ${type === "fixed" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>$</button>
      </div>
      {amount > 0
        ? <span className={`text-[11px] font-medium ml-auto ${sign === "-" ? "text-red-500" : "text-green-600"}`}>{sign}${amount.toFixed(2)}</span>
        : <span className="text-[11px] text-muted-foreground ml-auto">—</span>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const router = useRouter()

  const [invoiceList, setInvoiceList] = useState<InvoiceWithClient[]>([])
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [filterClient, setFilterClient] = useState<ClientProfile | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)

  const handleExportCaseSheet = async (invoiceId: string, invoiceNumber: string) => {
    setExportingId(invoiceId)
    try {
      const res = await fetch(`/api/admin/invoices/${invoiceId}/case-sheet`)
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

  // Generator panel
  const [showGenerator, setShowGenerator] = useState(false)
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [candidateCases, setCandidateCases] = useState<CandidateCase[]>([])
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set())
  const [fetchingCases, setFetchingCases] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [termsOfPayment, setTermsOfPayment] = useState("7 Days")

  const [adj, setAdj] = useState<Adjustments>({
    taxType: "percent", taxValue: "",
    discountType: "percent", discountValue: "",
    extraChargesType: "percent", extraChargesValue: "",
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [invRes, clientRes] = await Promise.all([
        fetch("/api/admin/invoices"),
        fetch("/api/admin/clients"),
      ])
      if (invRes.ok) setInvoiceList(await invRes.json())
      if (clientRes.ok) setClients(await clientRes.json())
    } catch { toast.error("Failed to load billing data") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Auto-fetch cases when client + dates change
  useEffect(() => {
    if (!selectedClient || !startDate || !endDate) {
      setCandidateCases([]); setSelectedCaseIds(new Set()); return
    }
    if (new Date(startDate) > new Date(endDate)) return
    setFetchingCases(true)
    fetch(`/api/billing/clients/${selectedClient.id}?startDate=${startDate}&endDate=${endDate}`)
      .then(r => r.json())
      .then(data => {
        const eligible: CandidateCase[] = (data.cases ?? []).filter(
          (c: CandidateCase) => c.status === "approved" || c.status === "delivered"
        )
        setCandidateCases(eligible)
        setSelectedCaseIds(new Set(eligible.map(c => c.id)))
      })
      .catch(() => toast.error("Failed to load cases"))
      .finally(() => setFetchingCases(false))
  }, [selectedClient?.id, startDate, endDate])

  // Selection
  const toggleCase = (id: string) => setSelectedCaseIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const toggleAll = () => setSelectedCaseIds(
    selectedCaseIds.size === candidateCases.length ? new Set() : new Set(candidateCases.map(c => c.id))
  )

  // Live totals
  const selectedSubtotal = candidateCases.filter(c => selectedCaseIds.has(c.id)).reduce((s, c) => s + c.price, 0)
  const taxAmt = calcAdj(selectedSubtotal, adj.taxValue, adj.taxType)
  const discountAmt = calcAdj(selectedSubtotal, adj.discountValue, adj.discountType)
  const extraAmt = calcAdj(selectedSubtotal, adj.extraChargesValue, adj.extraChargesType)
  const previewTotal = calcTotal(selectedSubtotal, adj)

  // Generate
  const handleGenerate = async () => {
    if (!selectedClient || selectedCaseIds.size === 0) { toast.error("Select a client and at least one case"); return }
    setGenerating(true)
    try {
      const res = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient.id, startDate, endDate,
          caseIds: [...selectedCaseIds],
          taxType: adj.taxType, taxValue: parseFloat(adj.taxValue) || 0,
          discountType: adj.discountType, discountValue: parseFloat(adj.discountValue) || 0,
          extraChargesType: adj.extraChargesType, extraChargesValue: parseFloat(adj.extraChargesValue) || 0,
          remarks: remarks || null, termsOfPayment,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed") }
      const created: InvoiceWithClient = await res.json()
      toast.success(`Invoice ${created.invoiceNumber} created`)
      setShowGenerator(false)
      resetGenerator()
      await loadData()
      router.push(`/admin/billing/${created.id}`)
    } catch (e: any) { toast.error(e.message ?? "Failed to generate invoice") }
    finally { setGenerating(false) }
  }

  const resetGenerator = () => {
    setSelectedClient(null); setStartDate(""); setEndDate("")
    setCandidateCases([]); setSelectedCaseIds(new Set())
    setRemarks(""); setTermsOfPayment("7 Days")
    setAdj({ taxType: "percent", taxValue: "", discountType: "percent", discountValue: "", extraChargesType: "percent", extraChargesValue: "" })
  }

  const handleExportSheet = () => {
    const selectedCases = candidateCases.filter(c => selectedCaseIds.has(c.id))
    if (selectedCases.length === 0) { toast.error("Select at least one case to export"); return }

    const headers = ["Case ID", "Case Number", "Category", "Sub-Type", "Teeth / Arch Selection", "Units / Arches Count", "Model Required", "Price (USD)"]

    const rows = selectedCases.map(c => {
      const d = (c.subTypeData ?? {}) as Record<string, unknown>
      const cat = (c.category ?? "").toLowerCase()
      let subType = "—"
      let selection = "—"
      let units = 0
      const modelRequired = d.modelRequired === "yes" ? "Yes" : "No"

      if (cat.includes("crown") || cat.includes("bridge")) {
        subType = String(d.sub_category || d.subCategory || d.caseType || "Crown")
        const teeth = Array.isArray(d.teeth) ? (d.teeth as number[]) : []
        selection = teeth.length > 0 ? teeth.map(t => `#${t}`).join(", ") : "—"
        units = teeth.length
      } else if (cat.includes("implant")) {
        const implantSubCat = String(d.sub_category || d.caseType1 || "Ti-Base")
        const cbType = String(d.caseType2 || "")
        subType = cbType && cbType !== "None" ? `${implantSubCat} - ${cbType}` : implantSubCat
        const implantTeeth = Array.isArray(d.teeth) ? (d.teeth as number[]) : []
        const cbTeeth = Array.isArray(d.crownBridgeTeeth) ? (d.crownBridgeTeeth as number[]) : []
        const implantParts = implantTeeth.map(t => `Imp:#${t}`)
        const cbParts = cbTeeth.map(t => `CB:#${t}`)
        selection = [...implantParts, ...cbParts].join(", ") || "—"
        units = implantTeeth.length + cbTeeth.length
      } else {
        subType = String(d.appliance_type || d.applianceType || d.sub_category || d.caseType1 || "—")
        const arch = String(d.arch || d.caseType2 || "Upper")
        selection = arch
        units = arch.toLowerCase().includes("both") || arch.toLowerCase().includes("full") ? 2 : 1
      }

      return [
        c.id,
        c.caseNumber || c.id.slice(0, 8),
        c.category ?? "—",
        subType,
        selection,
        units,
        modelRequired,
        c.price.toFixed(2),
      ]
    })

    const csvLines = [
      headers.map(h => `"${h}"`).join(","),
      ...rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")),
    ]
    const csvContent = csvLines.join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `cases-export-${new Date().toISOString().split("T")[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success(`Exported ${selectedCases.length} case${selectedCases.length !== 1 ? "s" : ""} to CSV`)
  }

  const getCaseLabel = (c: CandidateCase) => {
    const d = c.subTypeData ?? {}; const cat = c.category?.toLowerCase() ?? ""
    if (cat.includes("crown")) return `Crown & Bridge - ${d.sub_category || d.caseType || "Crown"}`
    if (cat.includes("implant")) return `Implants - ${d.sub_category || d.caseType1 || "Ti-Base"}`
    if (cat.includes("appliance")) return `Appliances - ${d.appliance_type || d.caseType1 || "Night Guards"}`
    if (cat.includes("denture")) return `Dentures - ${d.sub_category || d.caseType1 || "Full Denture"}`
    if (cat.includes("cosmetic")) return `Cosmetics - ${d.sub_category || d.caseType1 || "Veneers"}`
    return c.category ?? "—"
  }

  // Stats
  const displayedInvoices = filterClient ? invoiceList.filter(i => i.clientId === filterClient.id) : invoiceList
  const totalRevenue = displayedInvoices.reduce((s, i) => s + i.total, 0)
  const paidCount = displayedInvoices.filter(i => i.clientPaid).length
  const pendingCount = displayedInvoices.filter(i => !i.clientPaid).length
  const receivedCount = displayedInvoices.filter(i => i.received).length

  return (
    <AdminLayout>
      <div className="space-y-4 animate-fade-in">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Billing & Invoices</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Generate, track and download commercial invoices</p>
          </div>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-8 text-xs px-3 gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  {filterClient ? filterClient.labName || filterClient.fullName || filterClient.email : "All Clients"}
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuItem className="text-xs" onSelect={() => setFilterClient(null)}>All Clients</DropdownMenuItem>
                {clients.map(c => (
                  <DropdownMenuItem key={c.id} className="text-xs" onSelect={() => setFilterClient(c)}>
                    {c.labName || c.fullName || c.email}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button className="h-8 text-xs px-3 gap-1.5" onClick={() => setShowGenerator(v => !v)}>
              {showGenerator ? <><X className="h-3.5 w-3.5" />Close</> : <><Plus className="h-3.5 w-3.5" />New Invoice</>}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {filterClient ? "Client Total" : "Total Revenue"}
              </p>
              <p className="text-xl font-semibold text-foreground mt-0.5">
                ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded bg-green-100 text-green-700"><CheckCircle className="h-3.5 w-3.5" /></div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Client Paid</p>
                <p className="text-lg font-semibold text-foreground">{paidCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded bg-yellow-100 text-yellow-700"><Clock className="h-3.5 w-3.5" /></div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pending</p>
                <p className="text-lg font-semibold text-foreground">{pendingCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-card border-border/50">
            <CardContent className="p-3.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded bg-blue-100 text-blue-700"><BadgeCheck className="h-3.5 w-3.5" /></div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Received</p>
                <p className="text-lg font-semibold text-foreground">{receivedCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Generator panel */}
        {showGenerator && (
          <Card className="shadow-card border-border/50 animate-fade-in">
            <CardHeader className="py-2.5 px-4 border-b border-border">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" />Generate New Invoice
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-3 space-y-4">
              {/* Client + dates */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Client</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-8 text-xs w-full justify-between gap-1">
                        {selectedClient ? selectedClient.labName || selectedClient.fullName || selectedClient.email : "Select client"}
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-[200px]">
                      {clients.map(c => (
                        <DropdownMenuItem key={c.id} className="text-xs" onSelect={() => setSelectedClient(c)}>
                          {c.labName || c.fullName || c.email}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Start Date</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">End Date</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>

              {/* Terms + Remarks */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Terms of Payment</Label>
                  <Input value={termsOfPayment} onChange={e => setTermsOfPayment(e.target.value)} className="h-8 text-xs" placeholder="7 Days" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Remarks</Label>
                  <Input value={remarks} onChange={e => setRemarks(e.target.value)} className="h-8 text-xs" placeholder="Optional" />
                </div>
              </div>

              {/* Cases */}
              {selectedClient && startDate && endDate && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Eligible Cases</p>
                    {candidateCases.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">{selectedCaseIds.size} / {candidateCases.length} selected</span>
                    )}
                  </div>
                  {fetchingCases ? (
                    <div className="py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading cases…
                    </div>
                  ) : candidateCases.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground border border-dashed border-border rounded-md">
                      No approved or delivered cases found in this period.
                    </div>
                  ) : (
                    <div className="border border-border rounded-md overflow-hidden max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border text-muted-foreground uppercase text-[9px] font-semibold tracking-wider">
                            <th className="p-2.5 w-9 text-center">
                              <input type="checkbox"
                                checked={selectedCaseIds.size === candidateCases.length && candidateCases.length > 0}
                                onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer rounded" />
                            </th>
                            <th className="p-2.5 text-left">Case</th>
                            <th className="p-2.5 text-left">Service</th>
                            <th className="p-2.5 text-left">Units / Arches</th>
                            <th className="p-2.5 text-center">Model</th>
                            <th className="p-2.5 text-left">Date</th>
                            <th className="p-2.5 text-right">Price</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {candidateCases.map(c => {
                            const d = (c.subTypeData ?? {}) as Record<string, unknown>
                            const cat = (c.category ?? "").toLowerCase()
                            const isArchBased = cat.includes("appliance") || cat.includes("denture") || cat.includes("cosmetic")
                            const modelRequired = d.modelRequired === "yes"

                            let units = 0
                            if (cat.includes("crown") || cat.includes("bridge")) {
                              units = Array.isArray(d.teeth) ? (d.teeth as unknown[]).length : 0
                            } else if (cat.includes("implant")) {
                              const imp = Array.isArray(d.teeth) ? (d.teeth as unknown[]).length : 0
                              const cb = Array.isArray(d.crownBridgeTeeth) ? (d.crownBridgeTeeth as unknown[]).length : 0
                              units = imp + cb
                            } else {
                              const arch = String(d.arch || d.caseType2 || "Upper").toLowerCase()
                              units = (arch.includes("both") || arch.includes("full")) ? 2 : 1
                            }

                            const unitsLabel = isArchBased
                              ? `${units} arch${units !== 1 ? "es" : ""}`
                              : `${units} unit${units !== 1 ? "s" : ""}`

                            return (
                              <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                                <td className="p-2.5 text-center">
                                  <input type="checkbox" checked={selectedCaseIds.has(c.id)}
                                    onChange={() => toggleCase(c.id)} className="h-3.5 w-3.5 cursor-pointer rounded" />
                                </td>
                                <td className="p-2.5 font-medium whitespace-nowrap">{c.caseNumber || c.id.slice(0, 8)}</td>
                                <td className="p-2.5 text-muted-foreground">{getCaseLabel(c)}</td>
                                <td className="p-2.5 text-muted-foreground whitespace-nowrap">{unitsLabel}</td>
                                <td className="p-2.5 text-center">
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${modelRequired ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                                    {modelRequired ? "Yes" : "No"}
                                  </span>
                                </td>
                                <td className="p-2.5 text-muted-foreground whitespace-nowrap">{new Date(c.createdAt).toLocaleDateString()}</td>
                                <td className="p-2.5 text-right font-medium whitespace-nowrap">${c.price.toFixed(2)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Adjustments */}
              {selectedCaseIds.size > 0 && (
                <div className="space-y-3 pt-1">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Adjustments</p>
                  <div className="space-y-2">
                    <AdjRow label="Tax" value={adj.taxValue} type={adj.taxType} subtotal={selectedSubtotal}
                      onValue={v => setAdj(a => ({ ...a, taxValue: v }))} onType={t => setAdj(a => ({ ...a, taxType: t }))} sign="+" />
                    <AdjRow label="Discount" value={adj.discountValue} type={adj.discountType} subtotal={selectedSubtotal}
                      onValue={v => setAdj(a => ({ ...a, discountValue: v }))} onType={t => setAdj(a => ({ ...a, discountType: t }))} sign="-" />
                    <AdjRow label="Extra Charges" value={adj.extraChargesValue} type={adj.extraChargesType} subtotal={selectedSubtotal}
                      onValue={v => setAdj(a => ({ ...a, extraChargesValue: v }))} onType={t => setAdj(a => ({ ...a, extraChargesType: t }))} sign="+" />
                  </div>
                  <div className="border-t border-border pt-3 space-y-1 text-xs">
                    <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>${selectedSubtotal.toFixed(2)}</span></div>
                    {taxAmt > 0 && <div className="flex justify-between text-muted-foreground"><span>{adj.taxType === "percent" ? `Tax (${adj.taxValue}%)` : "Tax"}</span><span className="text-green-600">+${taxAmt.toFixed(2)}</span></div>}
                    {discountAmt > 0 && <div className="flex justify-between text-muted-foreground"><span>{adj.discountType === "percent" ? `Discount (${adj.discountValue}%)` : "Discount"}</span><span className="text-red-500">-${discountAmt.toFixed(2)}</span></div>}
                    {extraAmt > 0 && <div className="flex justify-between text-muted-foreground"><span>{adj.extraChargesType === "percent" ? `Extra Charges (${adj.extraChargesValue}%)` : "Extra Charges"}</span><span className="text-green-600">+${extraAmt.toFixed(2)}</span></div>}
                    <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1"><span>Total</span><span>${previewTotal.toFixed(2)}</span></div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={handleExportSheet}
                  disabled={selectedCaseIds.size === 0}
                  className="h-8 text-xs px-4 gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Sheet
                </Button>
                <Button onClick={handleGenerate} disabled={generating || !selectedClient || selectedCaseIds.size === 0} className="h-8 text-xs px-5 gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />
                  {generating ? "Generating…" : "Generate Invoice"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Invoice List */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 border-b border-border">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All Invoices</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Invoice No", "Client", "Period", "Total", "Client Paid", "Admin Received", "Status", ""].map(h => (
                      <th key={h} className="text-left px-3.5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    [1, 2, 3].map(n => (
                      <tr key={n}><td colSpan={8} className="px-3.5 py-4 text-center text-xs text-muted-foreground">Loading…</td></tr>
                    ))
                  ) : displayedInvoices.length === 0 ? (
                    <tr><td colSpan={8} className="px-3.5 py-8 text-center text-xs text-muted-foreground">No invoices yet. Click "New Invoice" to create one.</td></tr>
                  ) : displayedInvoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-muted/10 transition-colors">
                      {/* Invoice No */}
                      <td className="px-3.5 py-2.5 text-[11px] font-semibold text-primary whitespace-nowrap">
                        {inv.invoiceNumber}
                      </td>
                      {/* Client */}
                      <td className="px-3.5 py-2.5 text-[11px] text-foreground">
                        {inv.clientLabName || inv.clientName || inv.clientEmail}
                      </td>
                      {/* Period */}
                      <td className="px-3.5 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                        {inv.startDate} → {inv.endDate}
                      </td>
                      {/* Total */}
                      <td className="px-3.5 py-2.5 text-[11px] font-semibold text-foreground whitespace-nowrap">
                        ${inv.total.toFixed(2)}
                      </td>

                      {/* Client Paid indicator */}
                      <td className="px-3.5 py-2.5">
                        {inv.clientPaid ? (
                          <div className="flex items-center gap-1.5">
                            <CircleCheck className="h-4 w-4 text-green-500 shrink-0" />
                            <span className="text-[10px] text-green-600 font-medium whitespace-nowrap">
                              {inv.clientPaymentDate
                                ? new Date(inv.clientPaymentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                : "Paid"}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <CircleX className="h-4 w-4 text-red-400 shrink-0" />
                            <span className="text-[10px] text-red-500 font-medium">Unpaid</span>
                          </div>
                        )}
                      </td>

                      {/* Admin Received indicator */}
                      <td className="px-3.5 py-2.5">
                        {inv.received ? (
                          <div className="flex items-center gap-1.5">
                            <BadgeCheck className="h-4 w-4 text-blue-500 shrink-0" />
                            <span className="text-[10px] text-blue-600 font-medium whitespace-nowrap">
                              {inv.receivedConfirmationId
                                ? `#${inv.receivedConfirmationId.slice(0, 8)}`
                                : inv.receivedOn
                                  ? new Date(inv.receivedOn).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                                  : "Confirmed"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Status badge */}
                      <td className="px-3.5 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize ${
                          inv.status === "paid"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                        }`}>
                          {inv.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="View invoice"
                            onClick={() => router.push(`/admin/billing/${inv.id}`)}>
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Export case sheet"
                            disabled={exportingId === inv.id}
                            onClick={() => handleExportCaseSheet(inv.id, inv.invoiceNumber)}>
                            <Download className={`h-3.5 w-3.5 ${exportingId === inv.id ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
                          </Button>
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
    </AdminLayout>
  )
}
