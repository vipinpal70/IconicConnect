"use client"

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { Badge } from "@/src/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { MillingSubNav } from "../_components/MillingSubNav";
import { ManageUsersDialog } from "../_components/ManageUsersDialog";
import { MillingServiceCatalogTable } from "@/src/components/MillingServiceCatalogTable";
import { uploadMillingCenterContract } from "@/src/lib/upload-utils";
import { Plus, Edit3, Users, RefreshCw, Upload, FileText, Download } from "lucide-react";
import { toast } from "sonner";
import type { MillingCenter } from "@/src/db/schema/milling";
import type { ServiceType } from "@/src/lib/case-status-mapping";

const emptyStep1 = {
  name: "", legalName: "", contactName: "", email: "", phone: "",
  ownerName: "", ownerEmail: "", ownerPhone: "",
  financePocName: "", financePocEmail: "", financePocPhone: "",
  city: "", state: "", country: "USA", password: "",
};
type Step1Form = typeof emptyStep1;

const emptyStep2 = { statesServed: "", avgTatDays: "", enabledServiceTypes: [] as ServiceType[] };
type Step2Form = typeof emptyStep2;

const FLOW_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: "design_only", label: "Design" },
  { value: "design_milling", label: "Design + Milling" },
  { value: "milling_only", label: "Milling Only" },
];
const FLOW_LABELS: Record<ServiceType, string> = Object.fromEntries(FLOW_OPTIONS.map((f) => [f.value, f.label])) as Record<ServiceType, string>;

function toCsv(values?: string[] | null) {
  return values?.join(", ") ?? "";
}
function fromCsv(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function step1FromCenter(c: MillingCenter): Step1Form {
  return {
    name: c.name, legalName: c.legalName || "", contactName: c.contactName || "", email: c.email || "", phone: c.phone || "",
    ownerName: c.ownerName || "", ownerEmail: c.ownerEmail || "", ownerPhone: c.ownerPhone || "",
    financePocName: c.financePocName || "", financePocEmail: c.financePocEmail || "", financePocPhone: c.financePocPhone || "",
    city: c.city || "", state: c.state || "", country: c.country || "", password: "",
  };
}
function step2FromCenter(c: MillingCenter): Step2Form {
  return {
    statesServed: toCsv(c.statesServed),
    avgTatDays: c.avgTatDays != null ? String(c.avgTatDays) : "",
    enabledServiceTypes: (c.enabledServiceTypes || []) as ServiceType[],
  };
}

async function fetchCenters(): Promise<MillingCenter[]> {
  const res = await fetch("/api/admin/milling/centers");
  if (!res.ok) throw new Error("Failed to load centres");
  const json = await res.json();
  return json.data;
}

export default function MillingCentersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  // null = a brand-new centre not yet saved. Once step 1 is saved (create or
  // edit), this holds the live row so step 2 / the contract upload can target it.
  const [activeCenter, setActiveCenter] = useState<MillingCenter | null>(null);
  const [form1, setForm1] = useState<Step1Form>(emptyStep1);
  const [form2, setForm2] = useState<Step2Form>(emptyStep2);
  const [catalogTab, setCatalogTab] = useState<ServiceType | null>(null);
  const [managingCenter, setManagingCenter] = useState<MillingCenter | null>(null);
  const [contractUploading, setContractUploading] = useState(false);
  const [contractProgress, setContractProgress] = useState(0);
  const contractFileInputRef = useRef<HTMLInputElement>(null);

  const { data: list = [], isLoading } = useQuery<MillingCenter[]>({
    queryKey: ["admin-milling-centers"],
    queryFn: fetchCenters,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-milling-centers"] });

  const closeDialog = () => {
    setOpen(false);
    setStep(1);
    setActiveCenter(null);
    setForm1(emptyStep1);
    setForm2(emptyStep2);
    setCatalogTab(null);
  };

  const saveStep1Mutation = useMutation({
    mutationFn: async () => {
      const url = activeCenter ? `/api/admin/milling/centers/${activeCenter.id}` : "/api/admin/milling/centers";
      const {
        name, legalName, contactName, email, phone,
        ownerName, ownerEmail, ownerPhone,
        financePocName, financePocEmail, financePocPhone,
        city, state, country, password,
      } = form1;
      const payload: Record<string, unknown> = {
        name, legalName, contactName, email, phone,
        ownerName, ownerEmail, ownerPhone,
        financePocName, financePocEmail, financePocPhone,
        city, state, country,
      };
      // Login credentials are only ever set at creation — editing never touches them.
      if (!activeCenter && password) payload.password = password;

      const res = await fetch(url, {
        method: activeCenter ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save centre");
      }
      return res.json();
    },
    onSuccess: (data) => {
      const wasNew = !activeCenter;
      setActiveCenter(data.data);
      invalidate();
      if (wasNew && form1.password) {
        if (data.userError) {
          toast.error(`Centre onboarded, but the login was not created: ${data.userError}`, { duration: 10000 });
        } else {
          toast.success("Centre onboarded and login credentials emailed");
        }
      } else {
        toast.success(wasNew ? "Centre created" : "Centre updated");
      }
      setCatalogTab((prev) => prev ?? form2.enabledServiceTypes[0] ?? null);
      setStep(2);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveStep2Mutation = useMutation({
    mutationFn: async () => {
      if (!activeCenter) throw new Error("Save step 1 first");
      const res = await fetch(`/api/admin/milling/centers/${activeCenter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statesServed: fromCsv(form2.statesServed),
          avgTatDays: form2.avgTatDays === "" ? null : Number(form2.avgTatDays),
          enabledServiceTypes: form2.enabledServiceTypes,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save coverage details");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setActiveCenter(data.data);
      invalidate();
      toast.success("Centre onboarding complete");
      closeDialog();
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

  const openCreate = () => {
    setActiveCenter(null);
    setForm1(emptyStep1);
    setForm2(emptyStep2);
    setStep(1);
    setCatalogTab(null);
    setOpen(true);
  };

  const openEdit = (c: MillingCenter) => {
    setActiveCenter(c);
    setForm1(step1FromCenter(c));
    const step2 = step2FromCenter(c);
    setForm2(step2);
    setCatalogTab(step2.enabledServiceTypes[0] ?? null);
    setStep(1);
    setOpen(true);
  };

  const toggleServiceType = (value: ServiceType, checked: boolean) => {
    setForm2((prev) => {
      const enabledServiceTypes = checked
        ? [...prev.enabledServiceTypes, value]
        : prev.enabledServiceTypes.filter((v) => v !== value);
      return { ...prev, enabledServiceTypes };
    });
    if (checked) setCatalogTab(value);
  };

  const handleContractUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeCenter) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File exceeds the 25MB limit");
      return;
    }
    setContractUploading(true);
    setContractProgress(0);
    try {
      const result = await uploadMillingCenterContract(file, activeCenter.id, setContractProgress);
      setActiveCenter((prev) => (prev ? { ...prev, contractDocKey: result.contractDocKey, contractDocName: result.contractDocName } : prev));
      invalidate();
      toast.success("Contract document uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setContractUploading(false);
      setContractProgress(0);
    }
  };

  const downloadContract = async () => {
    if (!activeCenter) return;
    const res = await fetch(`/api/admin/milling/centers/${activeCenter.id}/contract`);
    if (!res.ok) {
      toast.error("Failed to get download link");
      return;
    }
    const { url } = await res.json();
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Milling Centres</h1>
          <p className="text-sm text-muted-foreground mt-1">Onboard, edit and manage partner centres</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); else setOpen(true); }}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />Onboard Centre
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{step === 1 ? "Company & Contacts" : "Coverage & Services"}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {activeCenter ? "Editing" : "Onboarding"} milling centre — Step {step} of 2
              </p>
            </DialogHeader>

            {step === 1 && (
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Company name *"><Input value={form1.name} onChange={(e) => setForm1({ ...form1, name: e.target.value })} /></Field>
                  <Field label="Company legal name"><Input value={form1.legalName} onChange={(e) => setForm1({ ...form1, legalName: e.target.value })} /></Field>
                </div>

                <div className="rounded-lg border border-border/60 p-3 space-y-1.5">
                  <Label className="text-xs">Contract document</Label>
                  {activeCenter ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      {activeCenter.contractDocName && (
                        <Badge variant="secondary" className="gap-1 text-[11px]">
                          <FileText className="h-3 w-3" />{activeCenter.contractDocName}
                        </Badge>
                      )}
                      {activeCenter.contractDocKey && (
                        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={downloadContract}>
                          <Download className="h-3.5 w-3.5" />Download
                        </Button>
                      )}
                      <Button
                        type="button" size="sm" variant="outline" className="h-7 text-xs gap-1"
                        disabled={contractUploading}
                        onClick={() => contractFileInputRef.current?.click()}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {contractUploading ? `Uploading… ${contractProgress}%` : activeCenter.contractDocKey ? "Replace" : "Upload"}
                      </Button>
                      <input
                        ref={contractFileInputRef}
                        type="file" accept=".pdf,.doc,.docx" className="hidden"
                        onChange={handleContractUpload}
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Save the centre once (click Next) to enable contract upload.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-primary/70">Point of contact (used for milling portal login)</p>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="POC name"><Input value={form1.contactName} onChange={(e) => setForm1({ ...form1, contactName: e.target.value })} /></Field>
                    <Field label="POC email"><Input value={form1.email} onChange={(e) => setForm1({ ...form1, email: e.target.value })} /></Field>
                    <Field label="POC phone"><Input value={form1.phone} onChange={(e) => setForm1({ ...form1, phone: e.target.value })} /></Field>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-primary/70">Lab owner</p>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Name"><Input value={form1.ownerName} onChange={(e) => setForm1({ ...form1, ownerName: e.target.value })} /></Field>
                    <Field label="Email"><Input value={form1.ownerEmail} onChange={(e) => setForm1({ ...form1, ownerEmail: e.target.value })} /></Field>
                    <Field label="Phone"><Input value={form1.ownerPhone} onChange={(e) => setForm1({ ...form1, ownerPhone: e.target.value })} /></Field>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-primary/70">Finance POC</p>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Name"><Input value={form1.financePocName} onChange={(e) => setForm1({ ...form1, financePocName: e.target.value })} /></Field>
                    <Field label="Email"><Input value={form1.financePocEmail} onChange={(e) => setForm1({ ...form1, financePocEmail: e.target.value })} /></Field>
                    <Field label="Phone"><Input value={form1.financePocPhone} onChange={(e) => setForm1({ ...form1, financePocPhone: e.target.value })} /></Field>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Field label="City / HQ"><Input value={form1.city} onChange={(e) => setForm1({ ...form1, city: e.target.value })} /></Field>
                  <Field label="State"><Input value={form1.state} onChange={(e) => setForm1({ ...form1, state: e.target.value })} /></Field>
                  <Field label="Country"><Input value={form1.country} onChange={(e) => setForm1({ ...form1, country: e.target.value })} /></Field>
                </div>

                {!activeCenter && (
                  <Field label="Login password (optional — creates the centre's first Milling Admin login)">
                    <div className="flex gap-1.5">
                      <Input
                        value={form1.password}
                        onChange={(e) => setForm1({ ...form1, password: e.target.value })}
                        placeholder="Leave blank to onboard without a login"
                      />
                      <Button
                        type="button" variant="outline" size="icon" className="shrink-0"
                        title="Generate random password"
                        onClick={() => setForm1({ ...form1, password: Math.random().toString(36).slice(-10) + "!" })}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {form1.password && !form1.email && (
                      <p className="text-[11px] text-warning">POC email is required above to create a login.</p>
                    )}
                  </Field>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={() => {
                      if (!form1.name) { toast.error("Company name required"); return; }
                      saveStep1Mutation.mutate();
                    }}
                    disabled={saveStep1Mutation.isPending}
                  >
                    {saveStep1Mutation.isPending ? "Saving…" : "Next"}
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && activeCenter && (
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="States served">
                    <Input
                      value={form2.statesServed}
                      onChange={(e) => setForm2({ ...form2, statesServed: e.target.value })}
                      placeholder="CA, NY, TX or ALL"
                    />
                  </Field>
                  <Field label="Avg TAT (days)">
                    <Input
                      type="number" min="0"
                      value={form2.avgTatDays}
                      onChange={(e) => setForm2({ ...form2, avgTatDays: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Services offered</Label>
                  <div className="flex flex-wrap gap-4">
                    {FLOW_OPTIONS.map((flow) => (
                      <label key={flow.value} className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={form2.enabledServiceTypes.includes(flow.value)}
                          onCheckedChange={(v) => toggleServiceType(flow.value, v)}
                        />
                        {flow.label}
                      </label>
                    ))}
                  </div>
                </div>

                {form2.enabledServiceTypes.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Service catalog</Label>
                    <Tabs value={catalogTab ?? form2.enabledServiceTypes[0]} onValueChange={(v) => setCatalogTab(v as ServiceType)}>
                      <TabsList>
                        {form2.enabledServiceTypes.map((flow) => (
                          <TabsTrigger key={flow} value={flow} className="text-xs">{FLOW_LABELS[flow]}</TabsTrigger>
                        ))}
                      </TabsList>
                      {form2.enabledServiceTypes.map((flow) => (
                        <TabsContent key={flow} value={flow}>
                          <MillingServiceCatalogTable centerId={activeCenter.id} serviceType={flow} />
                        </TabsContent>
                      ))}
                    </Tabs>
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <Button type="button" variant="secondary" onClick={() => setStep(1)}>Previous</Button>
                  <Button onClick={() => saveStep2Mutation.mutate()} disabled={saveStep2Mutation.isPending}>
                    {saveStep2Mutation.isPending ? "Saving…" : "Save & Finish"}
                  </Button>
                </div>
              </div>
            )}
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
                  {["Centre", "Location", "Services", "Avg TAT", "Active", "Users", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : list.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No milling centres onboarded yet.</td></tr>
                ) : list.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{c.name}</p>
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