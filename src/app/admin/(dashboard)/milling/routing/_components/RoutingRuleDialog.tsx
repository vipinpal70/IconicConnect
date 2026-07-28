"use client"

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import type { MillingCenter, MillingRoutingRule } from "@/src/db/schema/milling";
import type { RoutingRuleScope } from "@/src/lib/milling/routing-engine";

export interface RoutingRuleFormValues {
  name: string;
  priority: number;
  millingCenterId: string;
  fallbackMillingCenterId: string;
  active: boolean;
  countries: string;
  states: string;
  excludeStates: string;
  products: string;
  restorations: string;
  clients: string;
}

const emptyForm: RoutingRuleFormValues = {
  name: "",
  priority: 10,
  millingCenterId: "",
  fallbackMillingCenterId: "",
  active: true,
  countries: "",
  states: "",
  excludeStates: "",
  products: "",
  restorations: "",
  clients: "",
};

function toCsv(values?: string[]) {
  return values?.join(", ") ?? "";
}

function fromCsv(value: string): string[] | undefined {
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export function scopeToPayload(form: RoutingRuleFormValues): RoutingRuleScope {
  return {
    countries: fromCsv(form.countries),
    states: fromCsv(form.states),
    excludeStates: fromCsv(form.excludeStates),
    products: fromCsv(form.products),
    restorations: fromCsv(form.restorations),
    clients: fromCsv(form.clients),
  };
}

export function ruleToForm(rule: MillingRoutingRule): RoutingRuleFormValues {
  const scope = (rule.scope as RoutingRuleScope) || {};
  return {
    name: rule.name,
    priority: rule.priority,
    millingCenterId: rule.millingCenterId,
    fallbackMillingCenterId: rule.fallbackMillingCenterId ?? "",
    active: rule.active,
    countries: toCsv(scope.countries),
    states: toCsv(scope.states),
    excludeStates: toCsv(scope.excludeStates),
    products: toCsv(scope.products),
    restorations: toCsv(scope.restorations),
    clients: toCsv(scope.clients),
  };
}

export function RoutingRuleDialog({
  open,
  onOpenChange,
  centers,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  centers: MillingCenter[];
  initial: RoutingRuleFormValues | null;
  onSave: (form: RoutingRuleFormValues) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<RoutingRuleFormValues>(() => initial ?? emptyForm);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initial ? "Edit routing rule" : "Add routing rule"}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rule name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Priority (lower = evaluated first)">
              <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: +e.target.value })} />
            </Field>
            <Field label="Milling centre">
              <Select value={form.millingCenterId} onValueChange={(v) => setForm({ ...form, millingCenterId: v })}>
                <SelectTrigger><SelectValue placeholder="Select centre" /></SelectTrigger>
                <SelectContent>
                  {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fallback centre (optional)">
              <Select
                value={form.fallbackMillingCenterId || "none"}
                onValueChange={(v) => setForm({ ...form, fallbackMillingCenterId: v === "none" ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {centers.filter((c) => c.id !== form.millingCenterId).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Countries (comma-separated)">
              <Input value={form.countries} onChange={(e) => setForm({ ...form, countries: e.target.value })} placeholder="USA, Canada" />
            </Field>
            <Field label="States (comma-separated)">
              <Input value={form.states} onChange={(e) => setForm({ ...form, states: e.target.value })} placeholder="CA, NV, AZ" />
            </Field>
            <Field label="Exclude states (comma-separated)">
              <Input value={form.excludeStates} onChange={(e) => setForm({ ...form, excludeStates: e.target.value })} placeholder="CA" />
            </Field>
            <Field label="Products / categories (comma-separated)">
              <Input value={form.products} onChange={(e) => setForm({ ...form, products: e.target.value })} placeholder="Crown & Bridge" />
            </Field>
            <Field label="Restorations (comma-separated)">
              <Input value={form.restorations} onChange={(e) => setForm({ ...form, restorations: e.target.value })} placeholder="Zirconia Crown" />
            </Field>
            <Field label="Client IDs (comma-separated, optional)">
              <Input value={form.clients} onChange={(e) => setForm({ ...form, clients: e.target.value })} />
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            <Label className="text-xs">Active</Label>
          </div>

          <Button className="w-full" disabled={!form.name || !form.millingCenterId || saving} onClick={() => onSave(form)}>
            {saving ? "Saving…" : initial ? "Save changes" : "Add rule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
