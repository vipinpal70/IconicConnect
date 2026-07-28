"use client"

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { MillingSubNav } from "../_components/MillingSubNav";
import { ManageUsersDialog } from "../_components/ManageUsersDialog";
import { Plus, Edit3, Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { MillingCenter } from "@/src/db/schema/milling";

const emptyForm = { name: "", contactName: "", email: "", phone: "", city: "", state: "", country: "USA", password: "" };

async function fetchCenters(): Promise<MillingCenter[]> {
  const res = await fetch("/api/admin/milling/centers");
  if (!res.ok) throw new Error("Failed to load centres");
  const json = await res.json();
  return json.data;
}

export default function MillingCentersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MillingCenter | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [managingCenter, setManagingCenter] = useState<MillingCenter | null>(null);

  const { data: list = [], isLoading } = useQuery<MillingCenter[]>({
    queryKey: ["admin-milling-centers"],
    queryFn: fetchCenters,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-milling-centers"] });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const url = editing ? `/api/admin/milling/centers/${editing.id}` : "/api/admin/milling/centers";
      // Editing never touches login credentials — that's the "Manage" flow's job.
      const { name, contactName, email, phone, city, state, country } = data;
      const editFields = { name, contactName, email, phone, city, state, country };
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? editFields : data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save centre");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (!editing && form.password) {
        if (data.userError) {
          // Center is already saved — don't lose that. Surface the login
          // failure with a duration long enough to actually read, and jump
          // straight into "Manage" for this centre so it's a one-click retry
          // instead of a warning that's easy to miss and hard to act on.
          toast.error(`Centre onboarded, but the login was not created: ${data.userError}`, { duration: 10000 });
          setManagingCenter(data.data);
        } else {
          toast.success("Centre onboarded and login credentials emailed");
        }
      } else {
        toast.success(editing ? "Centre updated" : "Milling centre onboarded");
      }
      invalidate();
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await fetch(`/api/admin/milling/centers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error("Failed to update centre");
      return res.json();
    },
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  const save = () => {
    if (!form.name) {
      toast.error("Name required");
      return;
    }
    saveMutation.mutate(form);
  };

  const openEdit = (c: MillingCenter) => {
    setEditing(c);
    setForm({
      name: c.name,
      contactName: c.contactName || "",
      email: c.email || "",
      phone: c.phone || "",
      city: c.city || "",
      state: c.state || "",
      country: c.country || "",
      password: "",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Milling Centres</h1>
          <p className="text-sm text-muted-foreground mt-1">Onboard, edit and manage partner centres</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setForm(emptyForm); }}>
              <Plus className="h-4 w-4 mr-2" />Onboard Centre
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing ? "Edit centre" : "Onboard milling centre"}</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Company name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Contact person"><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
                <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
                <Field label="State"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
                <Field label="Country"><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
              </div>
              {!editing && (
                <Field label="Login password (optional — creates the centre's first Milling Admin login)">
                  <div className="flex gap-1.5">
                    <Input
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="Leave blank to onboard without a login"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      title="Generate random password"
                      onClick={() => setForm({ ...form, password: Math.random().toString(36).slice(-10) + "!" })}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {form.password && !form.email && (
                    <p className="text-[11px] text-warning">Email is required above to create a login.</p>
                  )}
                </Field>
              )}
              <Button className="w-full" onClick={save} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Onboard centre"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <MillingSubNav />

      <Card className="shadow-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Centre", "Location", "Active", "Users", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : list.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No milling centres onboarded yet.</td></tr>
                ) : list.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.contactName} · {c.email}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{[c.city, c.state].filter(Boolean).join(", ")} · {c.country}</td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={c.active}
                        onCheckedChange={(v) => toggleMutation.mutate({ id: c.id, active: v })}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="ghost" onClick={() => setManagingCenter(c)}>
                        <Users className="h-3.5 w-3.5 mr-1.5" />Manage
                      </Button>
                    </td>
                    <td className="px-4 py-3"><Button size="sm" variant="ghost" onClick={() => openEdit(c)}><Edit3 className="h-3.5 w-3.5" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ManageUsersDialog
        center={managingCenter}
        open={Boolean(managingCenter)}
        onOpenChange={(o) => !o && setManagingCenter(null)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
