"use client"

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { Badge } from "@/src/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { MillingSubNav } from "../_components/MillingSubNav";
import { ManageUsersDialog } from "../_components/ManageUsersDialog";
import { Plus, Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { MillingCenter } from "@/src/db/schema/milling";
import type { ServiceType } from "@/src/lib/case-status-mapping";

const emptyForm = {
  name: "", legalName: "", contactName: "", email: "", phone: "",
  ownerName: "", ownerEmail: "", ownerPhone: "",
  financePocName: "", financePocEmail: "", financePocPhone: "",
  city: "", state: "", country: "USA", password: "",
};

const FLOW_LABELS: Record<ServiceType, string> = {
  design_only: "Design",
  design_milling: "Design + Milling",
  milling_only: "Milling Only",
};

async function fetchCenters(): Promise<MillingCenter[]> {
  const res = await fetch("/api/admin/milling/centers");
  if (!res.ok) throw new Error("Failed to load centres");
  const json = await res.json();
  return json.data;
}

export default function MillingCentersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [managingCenter, setManagingCenter] = useState<MillingCenter | null>(null);

  const { data: list = [], isLoading } = useQuery<MillingCenter[]>({
    queryKey: ["admin-milling-centers"],
    queryFn: fetchCenters,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-milling-centers"] });

  const closeDialog = () => {
    setOpen(false);
    setForm(emptyForm);
  };

  // Onboarding only ever creates the row here — everything else (coverage,
  // services, catalog, contract doc) is managed on the centre's detail page.
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/milling/centers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create centre");
      }
      return res.json();
    },
    onSuccess: (data) => {
      invalidate();
      if (form.password) {
        if (data.userError) {
          toast.error(`Centre onboarded, but the login was not created: ${data.userError}`, { duration: 10000 });
        } else {
          toast.success("Centre onboarded and login credentials emailed");
        }
      } else {
        toast.success("Centre created");
      }
      closeDialog();
      router.push(`/admin/milling/centers/${data.data.id}`);
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Milling Centres</h1>
          <p className="text-sm text-muted-foreground mt-1">Onboard partner centres — click a centre to manage it</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); else setOpen(true); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setForm(emptyForm)}>
              <Plus className="h-4 w-4 mr-2" />Onboard Centre
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Onboard milling centre</DialogTitle>
              <p className="text-xs text-muted-foreground">
                Coverage, services and the service catalog are set up on the centre&apos;s page after creation.
              </p>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Company name *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Company legal name"><Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></Field>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-primary/70">Point of contact (used for milling portal login)</p>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="POC name"><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
                  <Field label="POC email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                  <Field label="POC phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-primary/70">Lab owner</p>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Name"><Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></Field>
                  <Field label="Email"><Input value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} /></Field>
                  <Field label="Phone"><Input value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} /></Field>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-primary/70">Finance POC</p>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Name"><Input value={form.financePocName} onChange={(e) => setForm({ ...form, financePocName: e.target.value })} /></Field>
                  <Field label="Email"><Input value={form.financePocEmail} onChange={(e) => setForm({ ...form, financePocEmail: e.target.value })} /></Field>
                  <Field label="Phone"><Input value={form.financePocPhone} onChange={(e) => setForm({ ...form, financePocPhone: e.target.value })} /></Field>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="City / HQ"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
                <Field label="State"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
                <Field label="Country"><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
              </div>

              <Field label="Login password (optional — creates the centre's first Milling Admin login)">
                <div className="flex gap-1.5">
                  <Input
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Leave blank to onboard without a login"
                  />
                  <Button
                    type="button" variant="outline" size="icon" className="shrink-0"
                    title="Generate random password"
                    onClick={() => setForm({ ...form, password: Math.random().toString(36).slice(-10) + "!" })}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {form.password && !form.email && (
                  <p className="text-[11px] text-warning">POC email is required above to create a login.</p>
                )}
              </Field>

              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    if (!form.name) { toast.error("Company name required"); return; }
                    createMutation.mutate();
                  }}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating…" : "Create centre"}
                </Button>
              </div>
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
                  {["Centre", "Location", "Services", "Avg TAT", "Active", "Users"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : list.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No milling centres onboarded yet.</td></tr>
                ) : list.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-muted/40 cursor-pointer"
                    onClick={() => router.push(`/admin/milling/centers/${c.id}`)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground hover:text-primary">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.contactName} · {c.email}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{[c.city, c.state].filter(Boolean).join(", ")} · {c.country}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(c.enabledServiceTypes?.length ?? 0) === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          (c.enabledServiceTypes as ServiceType[]).map((flow) => (
                            <Badge key={flow} variant="secondary" className="text-[10px]">{FLOW_LABELS[flow] ?? flow}</Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.avgTatDays != null ? `${c.avgTatDays}d` : "—"}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={c.active}
                        onCheckedChange={(v) => toggleMutation.mutate({ id: c.id, active: v })}
                      />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" onClick={() => setManagingCenter(c)}>
                        <Users className="h-3.5 w-3.5 mr-1.5" />Manage
                      </Button>
                    </td>
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