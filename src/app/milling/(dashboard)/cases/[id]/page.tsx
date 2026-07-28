"use client"

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { MillingStatusBadge, type MillingStatus } from "@/src/components/MillingStatusBadge";
import { INTERNAL_STATUS_LABELS, type CaseTimelineEvent } from "@/src/db/schema/case";
import { millingStatusEnum } from "@/src/db/schema/milling";
import { ArrowLeft, Download, Upload, MessageSquareWarning, Truck } from "lucide-react";
import { toast } from "sonner";

interface CaseFileRow {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string | null;
  note: string | null;
  createdAt: string;
}

interface MillingCaseDetail {
  caseId: string;
  caseNumber: string | null;
  category: string | null;
  subCategory: string | null;
  toothNumbers: number[];
  modelRequired: boolean;
  dueDate: string | null;
  millingStatus: MillingStatus;
  notes: string | null;
  shipToName: string | null;
  shipToAddress: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  designFileUrl: string | null;
  files: CaseFileRow[];
  timeline: CaseTimelineEvent[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Failed to load ${url}`);
  }
  const json = await res.json();
  return json.data;
}

export default function MillingCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<MillingStatus | null>(null);
  const [carrier, setCarrier] = useState<"UPS" | "FedEx" | "DHL">("UPS");
  const [tracking, setTracking] = useState("");
  const [flagMessage, setFlagMessage] = useState("");

  const { data: record, isLoading } = useQuery<MillingCaseDetail>({
    queryKey: ["milling-case", id],
    queryFn: () => fetchJson(`/api/milling/cases/${id}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["milling-case", id] });

  const statusMutation = useMutation({
    mutationFn: async (next: MillingStatus) => {
      const res = await fetch(`/api/milling/cases/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Status updated");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const shipmentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/milling/cases/${id}/shipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrier, trackingNumber: tracking }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to record shipment");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Shipment recorded");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/milling/cases/${id}/files`, { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to upload file");
      return res.json();
    },
    onSuccess: () => {
      toast.success("File uploaded");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const flagMutation = useMutation({
    mutationFn: async (category: "case_issue" | "technical") => {
      const res = await fetch("/api/milling/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: `${category === "technical" ? "Technical issue" : "Clarification requested"} · ${record?.caseNumber ?? id}`,
          message: flagMessage || "No additional details provided.",
          category,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to raise flag");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Iconic Support notified");
      setFlagMessage("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <div className="text-center py-20 text-muted-foreground">Loading…</div>;
  }

  if (!record) {
    return (
      <div className="text-center py-20 text-muted-foreground">Case not found or not assigned to your centre.</div>
    );
  }

  const currentStatus = status ?? record.millingStatus;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => router.push("/milling/cases")}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-xl font-semibold text-foreground">{record.caseNumber ?? record.caseId} · {record.subCategory ?? "—"}</h1>
          <p className="text-sm text-muted-foreground">{record.category} · Ship to {record.shipToName ?? "—"} · Due {record.dueDate ? new Date(record.dueDate).toLocaleDateString() : "—"}</p>
        </div>
        <div className="ml-auto"><MillingStatusBadge status={record.millingStatus} /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="shadow-card lg:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-base">Case specs</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row k="Restoration" v={record.subCategory ?? "—"} />
            <Row k="Category" v={record.category ?? "—"} />
            <Row k="Model required" v={record.modelRequired ? "Yes" : "No"} />
            <Row k="Teeth" v={record.toothNumbers.length ? `#${record.toothNumbers.join(", #")}` : "—"} />
            <Row k="Due" v={record.dueDate ? new Date(record.dueDate).toLocaleDateString() : "—"} />
            <div className="pt-2 border-t border-border">
              <p className="text-muted-foreground mb-1">Design notes from Iconic</p>
              <p className="text-foreground">{record.notes || "—"}</p>
            </div>
            <div className="pt-2 border-t border-border">
              <p className="text-muted-foreground mb-1">Ship to</p>
              <p className="text-foreground">{record.shipToName ?? "—"}</p>
              <p className="text-foreground">{record.shipToAddress ?? "—"}</p>
            </div>
            <p className="text-xs text-muted-foreground italic pt-2">Client identity beyond shipping details is hidden. Contact Iconic Support for questions.</p>
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Files</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="border border-dashed border-border rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">Design output package</p>
                <p className="text-xs text-muted-foreground">Uploaded by Iconic design team</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!record.designFileUrl}
                onClick={() => record.designFileUrl && window.open(record.designFileUrl, "_blank")}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> {record.designFileUrl ? "Download" : "Not uploaded"}
              </Button>
            </div>
            <div className="border border-dashed border-border rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">Upload manufacturing files</p>
                <p className="text-xs text-muted-foreground">Post-mill scans, nesting layouts, QC photos</p>
              </div>
              <Button variant="outline" size="sm" disabled={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1.5" /> {uploadMutation.isPending ? "Uploading…" : "Upload"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                  e.target.value = "";
                }}
              />
            </div>
            {record.files.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-border">
                {record.files.map((f) => (
                  <a key={f.id} href={f.fileUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between text-xs hover:bg-muted/40 rounded px-2 py-1.5">
                    <span className="text-foreground truncate">{f.fileName}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">{new Date(f.createdAt).toLocaleDateString()}</span>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Production status</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-2 flex-1 min-w-56">
                <Label>Update status</Label>
                <Select value={currentStatus} onValueChange={(v) => setStatus(v as MillingStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {millingStatusEnum.enumValues.map((s) => (
                      <SelectItem key={s} value={s}>{INTERNAL_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={statusMutation.isPending} onClick={() => statusMutation.mutate(currentStatus)}>
                {statusMutation.isPending ? "Saving…" : "Save status"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" /> Shipment</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Carrier</Label>
              <Select value={carrier} onValueChange={(v) => setCarrier(v as typeof carrier)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UPS">UPS</SelectItem>
                  <SelectItem value="FedEx">FedEx</SelectItem>
                  <SelectItem value="DHL">DHL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Tracking number</Label>
              <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 1Z999AA10000000" />
            </div>
            <Button
              className="md:col-span-3"
              disabled={shipmentMutation.isPending || !tracking}
              onClick={() => shipmentMutation.mutate()}
            >
              {shipmentMutation.isPending ? "Recording…" : "Generate shipment"}
            </Button>
            {record.trackingNumber && (
              <p className="md:col-span-3 text-xs text-muted-foreground">Current: {record.carrier} · {record.trackingNumber}</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-base">Raise flag</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Clarification or technical issue…"
              rows={4}
              value={flagMessage}
              onChange={(e) => setFlagMessage(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={flagMutation.isPending} onClick={() => flagMutation.mutate("case_issue")}>
                <MessageSquareWarning className="h-4 w-4 mr-1.5" /> Request clarification
              </Button>
            </div>
            <Button variant="outline" className="w-full" disabled={flagMutation.isPending} onClick={() => flagMutation.mutate("technical")}>
              Raise technical issue
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {record.timeline.length === 0 ? (
                <p className="text-xs text-muted-foreground">No timeline events yet.</p>
              ) : (
                record.timeline.map((t) => (
                  <div key={t.id} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                    <div>
                      <p className="text-sm text-foreground">{t.label}</p>
                      <p className="text-xs text-muted-foreground">{new Date(t.actionAt).toLocaleString()} · {t.actor}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground font-medium text-right">{v}</span>
    </div>
  );
}
