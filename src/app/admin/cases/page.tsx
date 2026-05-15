"use client";

import { useMemo, useState } from "react";
import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { StatusBadge } from "@/src/components/StatusBadge";
import { CaseChat } from "@/src/components/CaseChat";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Badge } from "@/src/components/ui/badge";
import { cases as initial, caseTypes, type CaseStatus } from "@/src/data/demoData";
import { Search, ShieldCheck, UserPlus, ClipboardCheck, ArrowRight, MessageSquare, FileText, Filter, Building2, Clock } from "lucide-react";
import { toast } from "sonner";

const statuses: (CaseStatus | "All")[] = [
  "All", "Submitted", "In Validation", "In Design", "Internal QC",
  "Pending Client Approval", "Feedback", "On Hold", "Completed", "Cancelled",
];

const designers = [
  { id: "d1", name: "Alex Chen", load: 8 },
  { id: "d2", name: "Michael R.", load: 5 },
  { id: "d3", name: "Emma L.", load: 12 },
];

export default function AdminCases() {
  const [data, setData] = useState(initial);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "All">("All");
  const [client, setClient] = useState<string>("All");
  const [openCase, setOpenCase] = useState<typeof initial[0] | null>(null);

  const clients = useMemo(() => Array.from(new Set(initial.map((c) => "PrecisionDent"))), []); // Simplified for now

  const list = useMemo(() => {
    return data.filter((c) => {
      const s = search.toLowerCase();
      const matchSearch = !s || c.id.toLowerCase().includes(s) || c.restoration.toLowerCase().includes(s);
      const matchStatus = statusFilter === "All" || c.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [data, search, statusFilter]);

  const update = (id: string, patch: Partial<typeof initial[0]>) => {
    setData((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const validate = (id: string) => {
    update(id, { status: "In Design" });
    toast.success(`${id} validated · ready for designer allocation`);
  };

  const allocate = (id: string, designer: string) => {
    update(id, { designer, status: "In Design" });
    toast.success(`${id} allocated to ${designer}`);
  };

  const submitInternalQc = (id: string) => {
    update(id, { status: "Internal QC" });
    toast.success(`${id} submitted to Internal QC`);
  };

  const sendToClient = (id: string) => {
    update(id, { status: "Pending Client Approval" });
    toast.success(`${id} sent to client for approval`);
  };

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Cases — Review & Allocation</h1>
            <p className="text-sm text-muted-foreground mt-1">Triage incoming cases, allocate to designers and route through QC</p>
          </div>
        </div>

        <Card className="shadow-card border-border/50">
          <CardContent className="p-4 flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by case ID, client or restoration…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Select value={client} onValueChange={setClient}>
                <SelectTrigger className="w-full lg:w-48"><SelectValue placeholder="Client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Clients</SelectItem>
                  {clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="w-full lg:w-48"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Case ID", "Lab / Patient", "Type / Restoration", "Status", "Designer", "Due", "Actions"].map((h) => (
                      <th key={h} className="text-left px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {list.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 font-semibold text-primary">{c.id}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-foreground">PrecisionDent</div>
                        <div className="text-xs text-muted-foreground">{c.patientRef}</div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-foreground font-medium">{c.restoration}</p>
                        <p className="text-[10px] text-muted-foreground">{c.caseType} · {c.toothNumbers.length ? `#${c.toothNumbers.join(", #")}` : "—"}</p>
                      </td>
                      <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                      <td className="px-6 py-4 text-xs font-medium text-muted-foreground">{c.designer ?? <span className="italic opacity-50">unallocated</span>}</td>
                      <td className="px-6 py-4 text-xs text-muted-foreground whitespace-nowrap">{c.dueDate}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2 flex-wrap items-center">
                          {c.status === "Submitted" && (
                            <>
                              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => validate(c.id)}><ShieldCheck className="h-3.5 w-3.5" />Validate</Button>
                              <AllocateMenu onPick={(d) => allocate(c.id, d)} />
                            </>
                          )}
                          {c.status === "In Design" && !c.designer && (
                            <AllocateMenu onPick={(d) => allocate(c.id, d)} />
                          )}
                          {c.status === "In Design" && c.designer && (
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => submitInternalQc(c.id)}>
                              <ClipboardCheck className="h-3.5 w-3.5" /> Send to QC
                            </Button>
                          )}
                          {c.status === "Internal QC" && (
                            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => sendToClient(c.id)}>
                              Approve <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setOpenCase(c)}>
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!openCase} onOpenChange={(o) => !o && setOpenCase(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto p-0 border-none bg-background shadow-2xl">
          {openCase && (
            <div className="flex flex-col h-full">
              <div className="p-6 border-b border-border bg-card/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-foreground">{openCase.id}</h2>
                    <StatusBadge status={openCase.status} />
                  </div>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> PrecisionDent</span>
                  <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> {openCase.caseType}</span>
                  <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Due {openCase.dueDate}</span>
                </div>
              </div>

              <Tabs defaultValue="chat" className="flex-1 flex flex-col">
                <div className="px-6 bg-card/30">
                  <TabsList className="bg-transparent border-b border-transparent w-full justify-start h-12 gap-6 p-0">
                    <TabsTrigger value="chat" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 h-full text-xs font-semibold">Chat</TabsTrigger>
                    <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 h-full text-xs font-semibold">Details & Notes</TabsTrigger>
                    <TabsTrigger value="preferences" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 h-full text-xs font-semibold">Lab Preferences</TabsTrigger>
                  </TabsList>
                </div>

                <div className="p-6 flex-1">
                  <TabsContent value="chat" className="mt-0 h-full">
                    <CaseChat caseId={openCase.id} side="admin" author="Iconic Connect Team" heightClass="h-[400px]" />
                  </TabsContent>

                  <TabsContent value="details" className="mt-0 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Row k="Patient Ref" v={openCase.patientRef} />
                      <Row k="Restoration" v={openCase.restoration} />
                      <Row k="Designer" v={openCase.designer ?? "Not allocated"} />
                      <Row k="Teeth" v={openCase.toothNumbers.length ? `#${openCase.toothNumbers.join(", #")}` : "—"} />
                      <Row k="Model required" v={openCase.modelRequired ? "Yes" : "No"} />
                      <Row k="Submitted" v={openCase.createdAt} />
                    </div>
                    <div className="pt-4 border-t border-border">
                      <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-2">Instructions</p>
                      <div className="p-4 rounded-xl bg-muted/30 text-sm text-foreground italic border border-border/50">
                        "{openCase.notes || "No special instructions provided for this case."}"
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="preferences" className="mt-0 space-y-4">
                    <div className="p-6 text-center space-y-3">
                      <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
                        <FileText className="h-6 w-6" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground">Standard Lab Preferences</h4>
                        <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto">This lab uses standard Iconic Connect quality benchmarks. No custom preference overrides found.</p>
                      </div>
                      <Button variant="outline" size="sm" className="text-xs">Request Preference Form</Button>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/20 border border-border/30">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">{k}</span>
      <span className="text-sm text-foreground font-semibold">{v}</span>
    </div>
  );
}

function AllocateMenu({ onPick }: { onPick: (name: string) => void }) {
  return (
    <Select onValueChange={onPick}>
      <SelectTrigger className="h-8 text-xs w-[140px] bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 transition-colors">
        <span className="flex items-center"><UserPlus className="h-3.5 w-3.5 mr-1.5" /> Allocate</span>
      </SelectTrigger>
      <SelectContent>
        {designers.map((d) => (
          <SelectItem key={d.id} value={d.name}>
            <div className="flex items-center justify-between w-full gap-4">
              <span>{d.name}</span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1">{d.load} active</Badge>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
