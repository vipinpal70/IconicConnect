"use client"

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Plus, Edit3, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { MillingServiceCatalogItem } from "@/src/db/schema/milling";

type UnitType = "per_tooth" | "per_arch" | "per_case";
const emptyForm = { category: "", subCategory: "", unitType: "per_tooth" as UnitType, partnerRate: 0, turnaroundDays: 3 };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load services");
  const json = await res.json();
  return json.data;
}

export default function MillingServicesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MillingServiceCatalogItem | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: list = [], isLoading } = useQuery<MillingServiceCatalogItem[]>({
    queryKey: ["milling-services"],
    queryFn: () => fetchJson("/api/milling/services"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["milling-services"] });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const url = editing ? `/api/milling/services/${editing.id}` : "/api/milling/services";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save service");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(editing ? "Service updated" : "Service added");
      invalidate();
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/milling/services/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update service");
      return res.json();
    },
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/milling/services/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove service");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Service removed");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const save = () => {
    if (!form.category || !form.subCategory) {
      toast.error("Category and restoration are required");
      return;
    }
    saveMutation.mutate(form);
  };

  const openEdit = (r: MillingServiceCatalogItem) => {
    setEditing(r);
    setForm({
      category: r.category,
      subCategory: r.subCategory,
      unitType: r.unitType,
      partnerRate: Number(r.partnerRate),
      turnaroundDays: r.turnaroundDays ?? 3,
    });
    setOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Services</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage what your centre can mill and the rate you charge Iconic. Iconic&apos;s markup or client price is never shown here.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setForm(emptyForm); }}>
              <Plus className="h-4 w-4 mr-2" />Add Service
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Crown & Bridge" /></Field>
                <Field label="Restoration"><Input value={form.subCategory} onChange={(e) => setForm({ ...form, subCategory: e.target.value })} placeholder="e.g. Zirconia Crown" /></Field>
                <Field label="Unit type">
                  <Select value={form.unitType} onValueChange={(v) => setForm({ ...form, unitType: v as UnitType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_tooth">Per tooth</SelectItem>
                      <SelectItem value="per_arch">Per arch</SelectItem>
                      <SelectItem value="per_case">Per case</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Turnaround (days)"><Input type="number" value={form.turnaroundDays} onChange={(e) => setForm({ ...form, turnaroundDays: +e.target.value })} /></Field>
                <Field label="Rate charged to Iconic ($)"><Input type="number" value={form.partnerRate} onChange={(e) => setForm({ ...form, partnerRate: +e.target.value })} /></Field>
              </div>
              <Button className="w-full" onClick={save} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Add service"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Category", "Restoration", "Unit", "TAT", "Rate charged to Iconic", "Active", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No services added yet.</td></tr>
              ) : list.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 text-muted-foreground">{r.category}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{r.subCategory}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.unitType.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.turnaroundDays ?? "—"}d</td>
                  <td className="px-4 py-3 font-medium text-foreground">${Number(r.partnerRate).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={r.isActive}
                      onCheckedChange={(v) => toggleMutation.mutate({ id: r.id, isActive: v })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Edit3 className="h-3.5 w-3.5" /></Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Remove service "${r.subCategory}"?`)) deleteMutation.mutate(r.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
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
