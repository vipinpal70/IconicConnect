"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { OpsLayout } from "@/src/components/OpsLayout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Textarea } from "@/src/components/ui/textarea"
import { Label } from "@/src/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { toast } from "sonner"
import {
  ArrowUpRight,
  LifeBuoy,
  RefreshCcw,
  Search,
  Ticket,
} from "lucide-react"
import {
  SUPPORT_TICKET_PRIORITY_LABELS,
  SUPPORT_TICKET_STATUS_LABELS,
  SUPPORT_TICKET_STATUS_STYLES,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_TYPE_LABELS,
  type SupportTicketPriority,
  type SupportTicketStatus,
  type SupportTicketType,
} from "@/src/lib/support-tickets"

type SupportTicketRecord = {
  id: string
  ticketNumber: string
  clientId: string
  clientName: string | null
  labName: string | null
  clientEmail: string | null
  subject: string
  message: string
  category: SupportTicketType
  priority: SupportTicketPriority
  status: SupportTicketStatus
  adminNotes: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export default function SupportPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [openTicket, setOpenTicket] = useState<SupportTicketRecord | null>(null)
  const [draftStatus, setDraftStatus] = useState<SupportTicketStatus>("open")
  const [draftNotes, setDraftNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const { data, isLoading, error, refetch } = useQuery<{ data: SupportTicketRecord[] }>({
    queryKey: ["ops-support-tickets", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter)
      const res = await fetch(`/api/admin/support${params.toString() ? `?${params.toString()}` : ""}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Failed to load support tickets")
      return payload
    },
  })

  const tickets = useMemo(() => data?.data ?? [], [data])

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return tickets
    return tickets.filter((t) => {
      const haystack = [
        t.ticketNumber, t.subject, t.message, t.category, t.priority, t.status,
        t.labName || "", t.clientName || "", t.clientEmail || "",
      ].join(" ").toLowerCase()
      return haystack.includes(term)
    })
  }, [tickets, search])

  const metrics = useMemo(() => ({
    open: tickets.filter((t) => t.status === "open").length,
    active: tickets.filter((t) => t.status === "in_progress" || t.status === "awaiting_client").length,
    resolved: tickets.filter((t) => t.status === "resolved" || t.status === "closed").length,
  }), [tickets])

  const handleOpenTicket = (ticket: SupportTicketRecord) => {
    setOpenTicket(ticket)
    setDraftStatus(ticket.status)
    setDraftNotes(ticket.adminNotes || "")
  }

  const handleSave = async () => {
    if (!openTicket) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/support/${openTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: draftStatus, adminNotes: draftNotes }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Failed to update ticket")
      toast.success("Ticket updated")
      if (payload.data) {
        setOpenTicket(payload.data)
        setDraftStatus(payload.data.status)
        setDraftNotes(payload.data.adminNotes || "")
      }
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <OpsLayout>
      <div className="space-y-4 animate-fade-in">
        <div className="relative overflow-hidden rounded-lg border border-border/60 bg-primary p-4 text-white">
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur">
                <LifeBuoy className="h-3 w-3" />
                Support desk
              </div>
              <h1 className="text-white text-md font-semibold">Monitor and resolve support tickets</h1>
              <p className="mt-1 max-w-xl text-[11px] text-white/75">
                Review every client ticket, move them through the workflow, and leave notes for the team.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Open" value={metrics.open} />
              <Metric label="Active" value={metrics.active} />
              <Metric label="Done" value={metrics.resolved} />
            </div>
          </div>
        </div>

        <Card className="shadow-card border-border/60">
          <CardContent className="p-2.5 flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by ticket number, lab, subject, or message"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full lg:w-48 h-8 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All statuses</SelectItem>
                {SUPPORT_TICKET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{SUPPORT_TICKET_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60">
          <CardHeader className="p-3.5 pb-2">
            <CardTitle className="text-sm font-semibold">All tickets</CardTitle>
            <CardDescription className="text-[11px]">Tickets from all client labs. Click Manage to update status or add internal notes.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Ticket", "Client", "Lab", "Subject", "Category", "Priority", "Status", "Updated", "Action"].map((h) => (
                      <th key={h} className="px-3.5 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {Array.from({ length: 9 }).map((_, j) => (
                          <td key={j} className="px-3.5 py-2"><div className="h-3 w-16 rounded bg-muted animate-pulse" /></td>
                        ))}
                      </tr>
                    ))
                  ) : error ? (
                    <tr>
                      <td colSpan={9} className="px-3.5 py-8 text-center text-xs text-red-500">{(error as Error).message}</td>
                    </tr>
                  ) : filteredTickets.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3.5 py-8 text-center text-xs text-muted-foreground">No tickets match your filters.</td>
                    </tr>
                  ) : (
                    filteredTickets.map((ticket) => (
                      <tr key={ticket.id} className="border-b border-border/50 transition-colors hover:bg-muted/20">
                        <td className="px-3.5 py-2 font-semibold text-[11px] text-black">{ticket.ticketNumber}</td>
                        <td className="px-3.5 py-2 font-semibold text-[11px] text-black">{ticket.clientName || "Unknown"}</td>
                        <td className="px-3.5 py-2 text-[11px]">{ticket.labName || "—"}</td>
                        <td className="px-3.5 py-2">
                          <div className="max-w-[280px]">
                            <p className="font-semibold text-[11px] text-slate-700">{ticket.subject}</p>
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{ticket.message}</p>
                            {ticket.adminNotes && (
                              <p className="mt-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                Note: {ticket.adminNotes}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-3.5 py-2 text-[11px]">{SUPPORT_TICKET_TYPE_LABELS[ticket.category]}</td>
                        <td className="px-3.5 py-2 text-[11px]">{SUPPORT_TICKET_PRIORITY_LABELS[ticket.priority]}</td>
                        <td className="px-3.5 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0 text-[10px] font-semibold scale-90 origin-left shrink-0 ${SUPPORT_TICKET_STATUS_STYLES[ticket.status] || SUPPORT_TICKET_STATUS_STYLES.open}`}>
                            {SUPPORT_TICKET_STATUS_LABELS[ticket.status]}
                          </span>
                        </td>
                        <td className="px-3.5 py-2 text-[10px] text-muted-foreground whitespace-nowrap">
                          {new Date(ticket.updatedAt).toLocaleString()}
                        </td>
                        <td className="px-3.5 py-2">
                          <Button size="sm" variant="outline" className="h-7 text-[10px] px-2" onClick={() => handleOpenTicket(ticket)}>
                            <ArrowUpRight className="mr-1 h-3 w-3" />
                            Manage
                          </Button>
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

      <Dialog open={Boolean(openTicket)} onOpenChange={(open) => !open && setOpenTicket(null)}>
        <DialogContent className="sm:max-w-3xl">
          {openTicket && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-1.5 text-base font-bold">
                  <Ticket className="h-4 w-4 text-primary" />
                  {openTicket.ticketNumber}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {openTicket.labName || openTicket.clientName || "Unknown client"} · {SUPPORT_TICKET_TYPE_LABELS[openTicket.category]}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded bg-muted/20 p-3.5 border border-border/60">
                  <InfoRow label="Client" value={openTicket.clientName || "Unknown"} />
                  <InfoRow label="Lab" value={openTicket.labName || "—"} />
                  <InfoRow label="Email" value={openTicket.clientEmail || "—"} />
                  <InfoRow label="Priority" value={SUPPORT_TICKET_PRIORITY_LABELS[openTicket.priority]} />
                  <InfoRow label="Created" value={new Date(openTicket.createdAt).toLocaleString()} />
                  <InfoRow label="Updated" value={new Date(openTicket.updatedAt).toLocaleString()} />
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select value={draftStatus} onValueChange={(v) => setDraftStatus(v as SupportTicketStatus)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Update status" />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORT_TICKET_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{SUPPORT_TICKET_STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Internal notes</Label>
                    <Textarea
                      rows={6}
                      className="text-xs"
                      value={draftNotes}
                      onChange={(e) => setDraftNotes(e.target.value)}
                      placeholder="Internal notes for the support team..."
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex rounded-full px-2 py-0 text-[10px] font-semibold scale-90 origin-left shrink-0 ${SUPPORT_TICKET_STATUS_STYLES[openTicket.status] || SUPPORT_TICKET_STATUS_STYLES.open}`}>
                      Current: {SUPPORT_TICKET_STATUS_LABELS[openTicket.status]}
                    </span>
                    <Button onClick={handleSave} disabled={saving} size="sm" className="h-8 text-xs px-3">
                      <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                      {saving ? "Saving..." : "Save changes"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 rounded bg-muted/20 p-3.5 border border-border/60">
                <Label className="text-xs">Client message</Label>
                <p className="whitespace-pre-wrap text-xs text-foreground leading-normal">{openTicket.message}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </OpsLayout>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-left backdrop-blur">
      <p className="text-[9px] uppercase tracking-wide text-white/60">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-white">{value}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-slate-700 text-right">{value}</span>
    </div>
  )
}
