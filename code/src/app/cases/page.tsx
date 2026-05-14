"use client"

import { useMemo, useState, useRef } from "react";
import { OpsLayout } from "@/src/components/OpsLayout";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { StatusBadge } from "@/src/components/StatusBadge";
import { ToothChart } from "@/src/components/ToothChart";
import { cases as allCases, caseTypes, type CaseStatus } from "@/src/data/demoData";
import { Plus, Search, Download, Upload, X, FileBox } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Label } from "@/src/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";

interface BulkRow {
  fileName: string;
  caseType: string;
  modelRequired: "yes" | "no";
  teeth: number[];
  notes: string;
  extras: number;
}

const statusFilters: (CaseStatus | "All")[] = [
  "All", "Submitted", "In Validation", "In Design", "Internal QC",
  "Pending Client Approval", "Feedback", "On Hold", "Completed", "Cancelled",
];

export default function CasesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "All">("All");
  const [typeFilter, setTypeFilter] = useState<string | "All">("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  // Add Case form
  const [newType, setNewType] = useState<string>("Crown & Bridge");
  const [modelRequired, setModelRequired] = useState("no");
  const [teeth, setTeeth] = useState<number[]>([]);
  const [restoration, setRestoration] = useState("");
  const [notes, setNotes] = useState("");

  // Bulk upload
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () =>
      allCases.filter((c) => {
        const s = search.toLowerCase();
        const matchesSearch = !s || c.id.toLowerCase().includes(s) || c.patientRef.toLowerCase().includes(s) || c.restoration.toLowerCase().includes(s);
        const matchesStatus = statusFilter === "All" || c.status === statusFilter;
        const matchesType = typeFilter === "All" || c.caseType === typeFilter;
        const matchesFrom = !from || c.createdAt >= from;
        const matchesTo = !to || c.createdAt <= to;
        return matchesSearch && matchesStatus && matchesType && matchesFrom && matchesTo;
      }),
    [search, statusFilter, typeFilter, from, to],
  );

  const handleSubmit = () => {
    if (!restoration.trim()) return;
    setUploadOpen(false);
    setRestoration("");
    setNotes("");
    setTeeth([]);
    setModelRequired("no");
    setNewType("Crown & Bridge");
  };

  const onBulkFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, 10);
    const rows: BulkRow[] = picked.map((f) => ({
      fileName: f.name,
      caseType: "Crown & Bridge",
      modelRequired: "no",
      teeth: [],
      notes: "",
      extras: 0,
    }));
    setBulkRows(rows);
  };

  const updateBulkRow = (i: number, patch: Partial<BulkRow>) =>
    setBulkRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeBulkRow = (i: number) =>
    setBulkRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleBulkSubmit = () => {
    if (bulkRows.length === 0) return;
    setBulkRows([]);
    if (bulkFileRef.current) bulkFileRef.current.value = "";
    setUploadOpen(false);
  };

  return (
    <OpsLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Cases</h1>
            <p className="text-sm text-muted-foreground mt-1">{allCases.length} lifetime cases · {filtered.length} shown</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" /> Export Excel
            </Button>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Add New Case</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Submit New Case</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="single" className="mt-2">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="single">Single Case</TabsTrigger>
                    <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
                  </TabsList>

                  <TabsContent value="single" className="space-y-5 mt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Case Type</Label>
                        <Select value={newType} onValueChange={(v) => setNewType(v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {caseTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Model Required?</Label>
                        <RadioGroup value={modelRequired} onValueChange={setModelRequired} className="flex gap-6 pt-2">
                          <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="m-yes" /><Label htmlFor="m-yes" className="font-normal">Yes</Label></div>
                          <div className="flex items-center gap-2"><RadioGroupItem value="no" id="m-no" /><Label htmlFor="m-no" className="font-normal">No</Label></div>
                        </RadioGroup>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Restoration / Material</Label>
                      <Input placeholder="e.g. Zirconia Crown, A2 shade" value={restoration} onChange={(e) => setRestoration(e.target.value)} />
                    </div>

                    <div className="space-y-2">
                      <Label>Tooth Selection (USA Universal Numbering)</Label>
                      <ToothChart selected={teeth} onChange={setTeeth} />
                    </div>

                    <div className="space-y-2">
                      <Label>Additional Notes</Label>
                      <Textarea placeholder="Special instructions, shade reference, occlusion notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>

                    <Button className="w-full" onClick={handleSubmit}>Submit Case</Button>
                  </TabsContent>

                  <TabsContent value="bulk" className="space-y-4 mt-4">
                    {bulkRows.length === 0 ? (
                      <label className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors block">
                        <input
                          ref={bulkFileRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => onBulkFiles(e.target.files)}
                        />
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm font-medium text-foreground">Select up to 10 case files</p>
                        <p className="text-xs text-muted-foreground mt-1">STL, PLY, OBJ, ZIP — one row will appear per file</p>
                      </label>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">{bulkRows.length} cases ready</p>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => bulkFileRef.current?.click()}>Replace Selection</Button>
                            <Button variant="ghost" size="sm" onClick={() => setBulkRows([])}>Clear</Button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {bulkRows.map((row, i) => (
                            <Card key={i} className="shadow-sm">
                              <CardContent className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <FileBox className="h-4 w-4 text-primary shrink-0" />
                                    <p className="text-sm font-medium text-foreground truncate">{row.fileName}</p>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeBulkRow(i)}><X className="h-4 w-4" /></Button>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <Select value={row.caseType} onValueChange={(v) => updateBulkRow(i, { caseType: v })}>
                                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {caseTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  <RadioGroup value={row.modelRequired} onValueChange={(v) => updateBulkRow(i, { modelRequired: v as "yes" | "no" })} className="flex gap-4 items-center">
                                    <div className="flex items-center gap-1.5"><RadioGroupItem value="yes" id={`bm-yes-${i}`} /><Label htmlFor={`bm-yes-${i}`} className="text-xs">Yes</Label></div>
                                    <div className="flex items-center gap-1.5"><RadioGroupItem value="no" id={`bm-no-${i}`} /><Label htmlFor={`bm-no-${i}`} className="text-xs">No</Label></div>
                                  </RadioGroup>
                                </div>
                                <ToothChart selected={row.teeth} onChange={(t) => updateBulkRow(i, { teeth: t })} />
                                <Textarea
                                  value={row.notes}
                                  onChange={(e) => updateBulkRow(i, { notes: e.target.value })}
                                  placeholder="Notes for this case…"
                                  className="min-h-[60px]"
                                />
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                        <Button className="w-full" onClick={handleBulkSubmit}>Submit All Cases</Button>
                      </>
                    )}
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filters */}
        <Card className="shadow-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search cases..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v)}>
                <SelectTrigger className="w-full lg:w-56"><SelectValue placeholder="Case type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Case Types</SelectItem>
                  {caseTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full lg:w-44" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full lg:w-44" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {statusFilters.map((s) => (
                <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="shadow-card">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/30">
                  <tr className="border-b border-border">
                    {["Case ID", "Patient Ref", "Type", "Restoration", "Teeth", "Status", "Due"].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="hover:bg-muted/10 cursor-pointer transition-colors"
                      onClick={() => router.push(`/cases/${c.id}`)}
                    >
                      <td className="px-6 py-4 text-sm font-medium text-primary">{c.id}</td>
                      <td className="px-6 py-4 text-sm text-foreground">{c.patientRef}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">{c.caseType}</td>
                      <td className="px-6 py-4 text-sm text-foreground">{c.restoration}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{c.toothNumbers.length ? `#${c.toothNumbers.join(", #")}` : "—"}</td>
                      <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                      <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">May 20, 2024</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-muted-foreground">No cases match your filters</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </OpsLayout>
  );
}
