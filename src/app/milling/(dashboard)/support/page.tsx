"use client"

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Badge } from "@/src/components/ui/badge";
import { toast } from "sonner";
import type { SupportTicket } from "@/src/db/schema/support-ticket";
import {
  SUPPORT_TICKET_STATUS_LABELS,
  SUPPORT_TICKET_STATUS_STYLES,
  SUPPORT_TICKET_TYPE_LABELS,
} from "@/src/lib/support-tickets";

const emptyForm = { subject: "", message: "" };

export default function MillingSupportPage() {
  const queryClient = useQueryClient();
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
    mutationFn: async (data: typeof form) => {
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
              onClick={() => createMutation.mutate(form)}
            >
              {createMutation.isPending ? "Opening…" : "Open Ticket"}
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="p-4 text-sm">
            <p className="font-medium text-foreground">Participants</p>
            <p className="text-xs text-muted-foreground mt-1">Milling-related tickets automatically include Milling Support and Iconic Support. Conversations stay inside Iconic Connect.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Ticket #", "Subject", "Category", "Status", "Last update"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No tickets yet.</td></tr>
              ) : tickets.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium text-primary">{t.ticketNumber}</td>
                  <td className="px-4 py-3 text-foreground">{t.subject}</td>
                  <td className="px-4 py-3"><Badge variant="secondary" className="text-xs">{SUPPORT_TICKET_TYPE_LABELS[t.category]}</Badge></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SUPPORT_TICKET_STATUS_STYLES[t.status]}`}>{SUPPORT_TICKET_STATUS_LABELS[t.status]}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(t.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
