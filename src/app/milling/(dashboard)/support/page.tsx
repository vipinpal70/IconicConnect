"use client"

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Headset, Send } from "lucide-react";
import { toast } from "sonner";
import type { SupportTicket } from "@/src/db/schema/support-ticket";
import {
  SUPPORT_TICKET_TYPES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUS_LABELS,
  SUPPORT_TICKET_STATUS_STYLES,
  SUPPORT_TICKET_TYPE_LABELS,
  SUPPORT_TICKET_PRIORITY_LABELS,
  type SupportTicketType,
  type SupportTicketPriority,
} from "@/src/lib/support-tickets";

const emptyForm = { subject: "", message: "" };

export default function MillingSupportPage() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<SupportTicketType>("case_issue");
  const [priority, setPriority] = useState<SupportTicketPriority>("medium");
  const [form, setForm] = useState(emptyForm);

  const { data: tickets = [], isLoading } = useQuery<SupportTicket[]>({
    queryKey: ["milling-support"],
    queryFn: async () => {
      const res = await fetch("/api/milling/support");
      if (!res.ok) throw new Error("Failed to load tickets");
      const json = await res.json();
      return json.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form & { category: SupportTicketType; priority: SupportTicketPriority }) => {
      const res = await fetch("/api/milling/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create ticket");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Ticket created · Iconic Support notified");
      setForm(emptyForm);
      setCategory("case_issue");
      setPriority("medium");
      queryClient.invalidateQueries({ queryKey: ["milling-support"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Support</h1>
        <p className="text-sm text-muted-foreground mt-1">Conversations with Iconic Support · scoped to your centre</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="shadow-card lg:col-span-2">
          <CardContent className="p-4 space-y-4">
            <div className="grid gap-3.5 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as SupportTicketType)}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {SUPPORT_TICKET_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{SUPPORT_TICKET_TYPE_LABELS[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as SupportTicketPriority)}>
                  <SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger>
                  <SelectContent>
                    {SUPPORT_TICKET_PRIORITIES.map((level) => (
                      <SelectItem key={level} value={level}>{SUPPORT_TICKET_PRIORITY_LABELS[level]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input placeholder="Brief description" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                rows={5}
                placeholder="Describe the issue, include case IDs if relevant…"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </div>
            <Button
              disabled={createMutation.isPending || !form.subject || !form.message}
              onClick={() => createMutation.mutate({ ...form, category, priority })}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {createMutation.isPending ? "Opening…" : "Open Ticket"}
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/50">
          <CardContent className="p-4 text-sm flex flex-col h-full">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-linear-to-br from-[#2c926d] to-[#248763] text-white shadow-md">
              <Headset className="h-4 w-4" />
            </div>
            <p className="font-medium text-foreground mt-3">Participants</p>
            <p className="text-xs text-muted-foreground mt-1">Milling-related tickets automatically include Milling Support and Iconic Support. Conversations stay inside Iconic Connect.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Ticket #", "Subject", "Category", "Priority", "Status", "Last update"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : tickets.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No tickets yet.</td></tr>
                ) : tickets.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium text-primary whitespace-nowrap">{t.ticketNumber}</td>
                    <td className="px-4 py-3">
                      <div className="max-w-[320px]">
                        <p className="font-medium text-foreground">{t.subject}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.message}</p>
                        {t.adminNotes && (
                          <p className="mt-1.5 rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground bg-muted/30">
                            <span className="font-medium text-foreground">Iconic:</span> {t.adminNotes}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{SUPPORT_TICKET_TYPE_LABELS[t.category]}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{SUPPORT_TICKET_PRIORITY_LABELS[t.priority]}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SUPPORT_TICKET_STATUS_STYLES[t.status]}`}>{SUPPORT_TICKET_STATUS_LABELS[t.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{new Date(t.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
