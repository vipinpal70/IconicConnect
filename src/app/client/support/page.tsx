"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ClientLayout } from "@/src/components/ClientLayout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Textarea } from "@/src/components/ui/textarea"
import { Label } from "@/src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { toast } from "sonner"
import {
  Headset,
  LifeBuoy,
  Send,
  Ticket,
} from "lucide-react"
import {
  SUPPORT_TICKET_PRIORITY_LABELS,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUS_LABELS,
  SUPPORT_TICKET_STATUS_STYLES,
  SUPPORT_TICKET_TYPE_LABELS,
  SUPPORT_TICKET_TYPES,
  type SupportTicketPriority,
  type SupportTicketStatus,
  type SupportTicketType,
} from "@/src/lib/support-tickets"

type SupportTicketRecord = {
  id: string
  ticketNumber: string
  clientId: string
  subject: string
  message: string
  category: SupportTicketType
  priority: SupportTicketPriority
  status: SupportTicketStatus
  adminNotes: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  clientName: string | null
  labName: string | null
}

export default function ClientSupportPage() {
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [category, setCategory] = useState<SupportTicketType>("technical")
  const [priority, setPriority] = useState<SupportTicketPriority>("medium")
  const [saving, setSaving] = useState(false)

  const { data, isLoading, error, refetch } = useQuery<{ data: SupportTicketRecord[] }>({
    queryKey: ["client-support-tickets"],
    queryFn: async () => {
      const res = await fetch("/api/support")
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(payload.error || "Failed to load support tickets")
      }
      return payload
    },
  })

  const tickets = useMemo(() => data?.data ?? [], [data])

  const summary = useMemo(() => {
    const open = tickets.filter((ticket) => ticket.status === "open").length
    const inProgress = tickets.filter((ticket) => ticket.status === "in_progress" || ticket.status === "awaiting_client").length
    const resolved = tickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "closed").length
    return { open, inProgress, resolved }
  }, [tickets])

  const handleCreateTicket = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Add a subject and a message before submitting")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, category, priority }),
      })
      const payload = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(payload.error || "Failed to submit ticket")
      }

      toast.success("Ticket submitted")
      setSubject("")
      setMessage("")
      setCategory("technical")
      setPriority("medium")
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  const handleRequestCallback = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/support/callback", {
        method: "POST",
      })
      const payload = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(payload.error || "Failed to request callback")
      }

      toast.success("Callback request sent")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in">
        <div className="relative overflow-hidden rounded-lg border border-border/50 bg-primary p-4 text-white shadow-xl">
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-semibold  text-white backdrop-blur scale-95 origin-left">
                <LifeBuoy className="h-3 w-3" />
                Live support center
              </div>
              <h1 className="text-white text-md font-semibold">Raise and track support tickets</h1>
              <p className="mt-0.5 max-w-xl text-[11px] text-white/75">
                Submit an issue, follow progress, and keep every conversation tied to your lab account.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Open" value={summary.open} />
              <Metric label="Active" value={summary.inProgress} />
              <Metric label="Done" value={summary.resolved} />
            </div>
          </div>
        </div>

        <div className="grid gap-3.5 xl:grid-cols-3">
          <Card className="xl:col-span-2 shadow-card border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <Ticket className="h-3.5 w-3.5 text-primary" />
                New ticket
              </CardTitle>
              <p className="text-[10px] text-muted-foreground mt-0.5">Use a concise subject and include any case IDs or file names that help us reproduce the issue.</p>
            </CardHeader>
            <CardContent className="p-4 space-y-3.5">
              <div className="grid gap-3.5 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground">Category</Label>
                  <Select value={category} onValueChange={(value) => setCategory(value as SupportTicketType)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORT_TICKET_TYPES.map((type) => (
                        <SelectItem key={type} value={type} className="text-xs">
                          {SUPPORT_TICKET_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground">Priority</Label>
                  <Select value={priority} onValueChange={(value) => setPriority(value as SupportTicketPriority)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORT_TICKET_PRIORITIES.map((level) => (
                        <SelectItem key={level} value={level} className="text-xs">
                          {SUPPORT_TICKET_PRIORITY_LABELS[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">Subject</Label>
                <Input
                  className="h-8 text-xs"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Short summary of the problem"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">Message</Label>
                <Textarea
                  className="text-xs"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Describe what happened, when it happened, and what you expected to see"
                  rows={5}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button size="sm" className="h-8 text-xs font-semibold" onClick={handleCreateTicket} disabled={saving}>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  {saving ? "Submitting..." : "Submit ticket"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/50">
            <CardContent className="p-4 flex flex-col justify-between h-full">
              <div>
                <div className="flex h-9 w-9 items-center justify-center rounded bg-linear-to-br from-[#2c926d] to-[#248763] text-white shadow-md">
                  <Headset className="h-4 w-4" />
                </div>
                <h3 className="mt-3 text-xs font-semibold uppercase text-muted-foreground">Request a callback</h3>
                <p className="mt-1.5 text-[11px] text-muted-foreground leading-normal">
                  Ask the team to call you back and we&apos;ll notify the internal support desk with your lab details.
                </p>
                <div className="mt-3.5 space-y-2 rounded border border-border/50 bg-muted/20 p-3 text-[11px]">
                  <Row label="Request type" value="Callback request" />
                  <Row label="Hours" value="Mon-Sat, 9am-9pm IST" />
                  <Row label="Priority rule" value="Routed directly to admin" />
                </div>
              </div>
              <Button variant="outline" size="sm" className="mt-4 w-full h-8 text-xs font-semibold" onClick={handleRequestCallback} disabled={saving}>
                {saving ? "Sending..." : "Request callback"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Your tickets</CardTitle>
            <p className="text-[10px] text-muted-foreground mt-0.5">Track ticket progress and read the latest admin notes.</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Ticket", "Subject", "Category", "Priority", "Status", "Updated"].map((heading) => (
                      <th
                        key={heading}
                        className="px-3.5 py-2 text-left text-xs font-semibold text-muted-foreground"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index} className="border-b border-border/50">
                        <td className="px-3.5 py-2"><div className="h-3.5 w-16 rounded bg-muted animate-pulse" /></td>
                        <td className="px-3.5 py-2"><div className="h-3.5 w-48 rounded bg-muted animate-pulse" /></td>
                        <td className="px-3.5 py-2"><div className="h-3.5 w-16 rounded bg-muted animate-pulse" /></td>
                        <td className="px-3.5 py-2"><div className="h-3.5 w-12 rounded bg-muted animate-pulse" /></td>
                        <td className="px-3.5 py-2"><div className="h-5 w-16 rounded bg-muted animate-pulse" /></td>
                        <td className="px-3.5 py-2"><div className="h-3.5 w-20 rounded bg-muted animate-pulse" /></td>
                      </tr>
                    ))
                  ) : error ? (
                    <tr>
                      <td colSpan={6} className="px-3.5 py-8 text-center text-xs text-red-500">
                        {(error as Error).message}
                      </td>
                    </tr>
                  ) : tickets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3.5 py-8 text-center text-xs text-muted-foreground font-semibold">
                        No tickets have been created yet.
                      </td>
                    </tr>
                  ) : (
                    tickets.map((ticket) => (
                      <tr key={ticket.id} className="border-b border-border/50 transition-colors hover:bg-muted/10">
                        <td className="px-3.5 py-2 font-semibold  text-primary text-[11px] whitespace-nowrap">
                          {ticket.ticketNumber}
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="max-w-[280px]">
                            <p className="font-semibold text-foreground text-[11px]">{ticket.subject}</p>
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground leading-normal">{ticket.message}</p>
                            {ticket.adminNotes && (
                              <p className="mt-1.5 rounded border border-dashed border-border/50 px-2 py-0.5 text-[9px] text-muted-foreground leading-normal bg-muted/20">
                                <span className="font-semibold  text-foreground">Admin:</span> {ticket.adminNotes}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-3.5 py-2 text-muted-foreground text-[11px]">{SUPPORT_TICKET_TYPE_LABELS[ticket.category]}</td>
                        <td className="px-3.5 py-2 text-muted-foreground text-[11px]">{SUPPORT_TICKET_PRIORITY_LABELS[ticket.priority]}</td>
                        <td className="px-3.5 py-2">
                          <span className={`inline-flex rounded text-[10px] font-semibold  py-0.5 px-1.5 scale-95 origin-left ${SUPPORT_TICKET_STATUS_STYLES[ticket.status] || SUPPORT_TICKET_STATUS_STYLES.open}`}>
                            {SUPPORT_TICKET_STATUS_LABELS[ticket.status]}
                          </span>
                        </td>
                        <td className="px-3.5 py-2 text-muted-foreground text-[11px] whitespace-nowrap">
                          {new Date(ticket.updatedAt).toLocaleString()}
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
    </ClientLayout>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-white/15 bg-white/10 px-3 py-1.5 text-left backdrop-blur shrink-0 min-w-16">
      <p className="text-[9px] font-semibold  uppercase tracking-wider text-white/60 leading-none">{label}</p>
      <p className="mt-0.5 text-base font-black text-white leading-none">{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[10px] font-semibold text-foreground text-right">{value}</span>
    </div>
  )
}
