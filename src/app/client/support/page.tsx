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
      <div className="space-y-6 animate-fade-in">
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-linear-to-br from-[#1a7554] via-[#126d4c] to-[#116144] p-6 text-white shadow-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.14),transparent_30%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                <LifeBuoy className="h-3.5 w-3.5" />
                Live support center
              </div>
              <h1 className="text-white text-3xl font-semibold tracking-tight">Raise and track support tickets</h1>
              <p className="mt-2 max-w-xl text-sm text-white/75">
                Submit an issue, follow progress, and keep every conversation tied to your lab account.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Open" value={summary.open} />
              <Metric label="Active" value={summary.inProgress} />
              <Metric label="Done" value={summary.resolved} />
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2 shadow-card border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Ticket className="h-4 w-4 text-primary" />
                New ticket
              </CardTitle>
              <CardDescription>Use a concise subject and include any case IDs or file names that help us reproduce the issue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={(value) => setCategory(value as SupportTicketType)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORT_TICKET_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {SUPPORT_TICKET_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={(value) => setPriority(value as SupportTicketPriority)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORT_TICKET_PRIORITIES.map((level) => (
                        <SelectItem key={level} value={level}>
                          {SUPPORT_TICKET_PRIORITY_LABELS[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Short summary of the problem"
                />
              </div>

              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Describe what happened, when it happened, and what you expected to see"
                  rows={6}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleCreateTicket} disabled={saving}>
                  <Send className="mr-2 h-4 w-4" />
                  {saving ? "Submitting..." : "Submit ticket"}
                </Button>
                {/* <p className="text-xs text-muted-foreground">
                  Standard response time: within one business day.
                </p> */}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/60">
            <CardContent className="p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-[#2c926d] to-[#248763] text-white shadow-lg">
                <Headset className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Request a callback</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask the team to call you back and we&apos;ll notify the internal support desk with your lab details.
              </p>
              <div className="mt-5 space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm">
                <Row label="Request type" value="Callback request" />
                <Row label="Hours" value="Mon-Sat, 9am-9pm IST" />
                <Row label="Priority rule" value="Callback requests are routed to admin" />
              </div>
              <Button variant="outline" className="mt-4 w-full" onClick={handleRequestCallback} disabled={saving}>
                {saving ? "Sending..." : "Request callback"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Your tickets</CardTitle>
            <CardDescription>Track ticket progress and read the latest admin notes.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-860px text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Ticket", "Subject", "Category", "Priority", "Status", "Updated"].map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
                        <td className="px-4 py-4"><div className="h-4 w-24 rounded bg-muted" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-56 rounded bg-muted" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-24 rounded bg-muted" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-16 rounded bg-muted" /></td>
                        <td className="px-4 py-4"><div className="h-6 w-24 rounded-full bg-muted" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-24 rounded bg-muted" /></td>
                      </tr>
                    ))
                  ) : error ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-sm text-red-500">
                        {(error as Error).message}
                      </td>
                    </tr>
                  ) : tickets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        No tickets have been created yet.
                      </td>
                    </tr>
                  ) : (
                    tickets.map((ticket) => (
                      <tr key={ticket.id} className="border-b border-border/50 transition-colors hover:bg-muted/20">
                        <td className="px-4 py-4 font-semibold text-primary">
                          {ticket.ticketNumber}
                        </td>
                        <td className="px-4 py-4">
                          <div className="max-w-340px">
                            <p className="font-medium text-foreground">{ticket.subject}</p>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ticket.message}</p>
                            {ticket.adminNotes && (
                              <p className="mt-2 rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
                                Admin note: {ticket.adminNotes}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{SUPPORT_TICKET_TYPE_LABELS[ticket.category]}</td>
                        <td className="px-4 py-4 text-muted-foreground">{SUPPORT_TICKET_PRIORITY_LABELS[ticket.priority]}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${SUPPORT_TICKET_STATUS_STYLES[ticket.status] || SUPPORT_TICKET_STATUS_STYLES.open}`}>
                            {SUPPORT_TICKET_STATUS_LABELS[ticket.status]}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">
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
    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-left backdrop-blur">
      <p className="text-xs uppercase tracking-wide text-white/60">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground text-right">{value}</span>
    </div>
  )
}
