"use client"

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { MillingSubNav } from "../_components/MillingSubNav";
import { RoutingRuleDialog, ruleToForm, scopeToPayload, type RoutingRuleFormValues } from "./_components/RoutingRuleDialog";
import { Route, ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { MillingCenter, MillingRoutingRule } from "@/src/db/schema/milling";
import type { RoutingRuleScope } from "@/src/lib/milling/routing-engine";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const json = await res.json();
  return json.data;
}

export default function MillingRoutingPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MillingRoutingRule | null>(null);

  const { data: rules = [], isLoading: rulesLoading } = useQuery<MillingRoutingRule[]>({
    queryKey: ["admin-milling-routing"],
    queryFn: () => fetchJson("/api/admin/milling/routing"),
  });

  const { data: centers = [] } = useQuery<MillingCenter[]>({
    queryKey: ["admin-milling-centers"],
    queryFn: () => fetchJson("/api/admin/milling/centers"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-milling-routing"] });

  const saveMutation = useMutation({
    mutationFn: async (form: RoutingRuleFormValues) => {
      const payload = {
        name: form.name,
        priority: form.priority,
        millingCenterId: form.millingCenterId,
        fallbackMillingCenterId: form.fallbackMillingCenterId || null,
        active: form.active,
        scope: scopeToPayload(form),
      };
      const url = editing ? `/api/admin/milling/routing/${editing.id}` : "/api/admin/milling/routing";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save rule");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(editing ? "Rule updated" : "Rule added");
      invalidate();
      setDialogOpen(false);
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/milling/routing/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete rule");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Rule deleted");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const nameOf = (id?: string | null) => centers.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Routing Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">Automatically assign the right milling centre based on geography, product and client — same pattern as assigning a designer or QC</p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} disabled={!centers.length}>Add Rule</Button>
      </div>

      <MillingSubNav />

      <Card className="shadow-card">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Rules are evaluated by priority (lowest number first). If the primary centre is inactive, the fallback is used.</p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {rulesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No routing rules yet.</p>
        ) : (
          rules
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map((r) => {
              const scope = (r.scope as RoutingRuleScope) || {};
              return (
                <Card key={r.id} className="shadow-card">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between flex-wrap gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">{r.priority}</span>
                          <p className="font-semibold text-foreground">{r.name}</p>
                          {r.active ? <Badge variant="secondary" className="text-xs">Active</Badge> : <Badge variant="outline" className="text-xs">Disabled</Badge>}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                          {scope.countries?.map((s) => <Chip key={s} label={`Country: ${s}`} />)}
                          {scope.states?.map((s) => <Chip key={s} label={`State: ${s}`} />)}
                          {scope.excludeStates?.map((s) => <Chip key={"x" + s} label={`Except ${s}`} tone="warn" />)}
                          {scope.clients?.map((s) => <Chip key={s} label={`Client: ${s}`} />)}
                          {scope.products?.map((s) => <Chip key={s} label={`Product: ${s}`} />)}
                          {scope.restorations?.map((s) => <Chip key={s} label={`Restoration: ${s}`} />)}
                        </div>
                      </div>
                      <div className="text-sm min-w-60">
                        <p className="text-xs text-muted-foreground">Route to</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Route className="h-4 w-4 text-primary" />
                          <p className="font-medium text-foreground">{nameOf(r.millingCenterId)}</p>
                        </div>
                        {r.fallbackMillingCenterId && (
                          <div className="flex items-center gap-2 mt-2 text-muted-foreground text-xs">
                            <ArrowRight className="h-3 w-3" /> Fallback: {nameOf(r.fallbackMillingCenterId)}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setDialogOpen(true); }}>Edit</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Delete rule "${r.name}"?`)) deleteMutation.mutate(r.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
        )}
      </div>

      <RoutingRuleDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}
        centers={centers}
        initial={editing ? ruleToForm(editing) : null}
        onSave={(form) => saveMutation.mutate(form)}
        saving={saveMutation.isPending}
      />
    </div>
  );
}

function Chip({ label, tone = "default" }: { label: string; tone?: "default" | "warn" }) {
  const cls = tone === "warn" ? "bg-warning/10 text-warning" : "bg-secondary text-secondary-foreground";
  return <span className={`px-2 py-0.5 rounded-md ${cls}`}>{label}</span>;
}
