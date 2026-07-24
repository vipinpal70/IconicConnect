"use client"

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { Input } from "@/src/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { UploadCloud, X, Trash2, Loader2, Minus, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { uploadBulkFile } from "@/src/lib/upload-utils";

type MatchStatus = "pending" | "matched" | "unmatched" | "ambiguous" | "duplicate";

interface EligibleCase {
  id: string;
  caseNumber: string | null;
  category: string | null;
  scanFileName: string | null;
  clientDisplayName: string | null;
  qcId: string | null;
}

interface QcOption {
  id: string;
  name: string;
}

interface Row {
  tempId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  // upload state
  isUploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
  storageKey: string | null;
  // match state
  matchStatus: MatchStatus;
  matchedCaseId: string | null;
  candidateIds: string[];
  note: string;
  // preview file (optional, only offered once a case is matched)
  previewFileName: string | null;
  previewFileType: string | null;
  previewFileSize: number | null;
  previewIsUploading: boolean;
  previewUploadProgress: number;
  previewUploadError: string | null;
  previewStorageKey: string | null;
}

const PREVIEW_EXTENSIONS = [".html", ".htm", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".svg", ".heic", ".heif", ".ico"];

function validatePreviewFile(file: File): { isValid: boolean; error?: string } {
  const dot = file.name.lastIndexOf(".");
  const ext = dot !== -1 ? file.name.substring(dot).toLowerCase() : "";
  if (!PREVIEW_EXTENSIONS.includes(ext)) {
    return { isValid: false, error: "Only HTML or image files are allowed for preview." };
  }
  return { isValid: true };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Uploader role — decides where confirmed cases are routed (QC vs Client). */
  userRole?: string;
  /** Active QC members — used by designers to assign a QC before sending. */
  qcOptions?: QcOption[];
  /** Called after at least one case was successfully confirmed. */
  onCompleted?: () => void;
}

let idCounter = 0;
const nextId = () => `bulk-${Date.now()}-${idCounter++}`;

const STATUS_META: Record<MatchStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Uploading…", variant: "outline" },
  matched: { label: "Matched", variant: "default" },
  unmatched: { label: "No match", variant: "destructive" },
  ambiguous: { label: "Choose case", variant: "secondary" },
  duplicate: { label: "Duplicate", variant: "secondary" },
};

export function BulkOutputUploadModal({ open, onOpenChange, userRole, qcOptions = [], onCompleted }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [eligibleCases, setEligibleCases] = useState<EligibleCase[]>([]);
  const [isMatching, setIsMatching] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [selectedQcId, setSelectedQcId] = useState<string>("");
  const [activePreviewRowId, setActivePreviewRowId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewFileInputRef = useRef<HTMLInputElement>(null);

  const isDesigner = userRole === "designer";
  const routesTo = isDesigner ? "Internal QC" : "Client Review";
  const sendLabel = isDesigner ? "Send to QC" : "Send to Client";

  const patchRow = useCallback((tempId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)));
  }, []);

  const runMatch = useCallback(async () => {
    // Match every successfully uploaded row by file name.
    const uploaded = await new Promise<Row[]>((resolve) => {
      setRows((prev) => { resolve(prev.filter((r) => r.storageKey)); return prev; });
    });
    if (uploaded.length === 0) return;

    setIsMatching(true);
    try {
      const res = await fetch("/api/cases/bulk/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: uploaded.map((r) => ({ tempId: r.tempId, fileName: r.fileName })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Matching failed");

      setEligibleCases(data.eligibleCases ?? []);
      const byId = new Map<string, { status: MatchStatus; matchedCaseId: string | null; candidateIds: string[] }>();
      for (const r of data.results ?? []) {
        byId.set(r.tempId, { status: r.status, matchedCaseId: r.matchedCaseId, candidateIds: r.candidateIds ?? [] });
      }
      setRows((prev) => prev.map((row) => {
        const m = byId.get(row.tempId);
        return m ? { ...row, matchStatus: m.status, matchedCaseId: m.matchedCaseId, candidateIds: m.candidateIds } : row;
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Matching failed");
    } finally {
      setIsMatching(false);
    }
  }, []);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const newRows: Row[] = files.map((f) => ({
      tempId: nextId(),
      fileName: f.name,
      fileType: f.type || "application/octet-stream",
      fileSize: f.size,
      isUploading: true,
      uploadProgress: 0,
      uploadError: null,
      storageKey: null,
      matchStatus: "pending",
      matchedCaseId: null,
      candidateIds: [],
      note: "",
      previewFileName: null,
      previewFileType: null,
      previewFileSize: null,
      previewIsUploading: false,
      previewUploadProgress: 0,
      previewUploadError: null,
      previewStorageKey: null,
    }));
    setRows((prev) => [...prev, ...newRows]);

    // Upload each file, then re-run match once the whole batch settles.
    Promise.allSettled(
      files.map((file, i) => {
        const tempId = newRows[i].tempId;
        return uploadBulkFile(file, (p) => patchRow(tempId, { uploadProgress: p }))
          .then((res) => patchRow(tempId, { isUploading: false, uploadProgress: 100, storageKey: res.storageKey }))
          .catch((err: unknown) => patchRow(tempId, {
            isUploading: false,
            uploadError: err instanceof Error ? err.message : "Upload failed",
          }));
      }),
    ).then(() => { void runMatch(); });
  }, [patchRow, runMatch]);

  const removeRow = useCallback(async (row: Row) => {
    // Best-effort purge of the staged object from R2.
    if (row.storageKey) {
      fetch("/api/cases/bulk/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey: row.storageKey }),
      }).catch(() => {});
    }
    if (row.previewStorageKey) {
      fetch("/api/cases/bulk/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey: row.previewStorageKey }),
      }).catch(() => {});
    }
    setRows((prev) => prev.filter((r) => r.tempId !== row.tempId));
  }, []);

  const addPreviewFile = useCallback((tempId: string, file: File) => {
    const check = validatePreviewFile(file);
    if (!check.isValid) {
      toast.error(check.error || "Invalid preview file");
      return;
    }
    patchRow(tempId, {
      previewFileName: file.name,
      previewFileType: file.type || "application/octet-stream",
      previewFileSize: file.size,
      previewIsUploading: true,
      previewUploadProgress: 0,
      previewUploadError: null,
      previewStorageKey: null,
    });
    uploadBulkFile(file, (p) => patchRow(tempId, { previewUploadProgress: p }))
      .then((res) => patchRow(tempId, { previewIsUploading: false, previewUploadProgress: 100, previewStorageKey: res.storageKey }))
      .catch((err: unknown) => patchRow(tempId, {
        previewIsUploading: false,
        previewUploadError: err instanceof Error ? err.message : "Upload failed",
      }));
  }, [patchRow]);

  const removePreviewFile = useCallback((row: Row) => {
    if (row.previewStorageKey) {
      fetch("/api/cases/bulk/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey: row.previewStorageKey }),
      }).catch(() => {});
    }
    patchRow(row.tempId, {
      previewFileName: null,
      previewFileType: null,
      previewFileSize: null,
      previewUploadProgress: 0,
      previewUploadError: null,
      previewStorageKey: null,
    });
  }, [patchRow]);

  const casesById = useMemo(() => {
    const m = new Map<string, EligibleCase>();
    for (const c of eligibleCases) m.set(c.id, c);
    return m;
  }, [eligibleCases]);

  const anyUploading = rows.some((r) => r.isUploading || r.previewIsUploading);

  // Designers must route through QC: a matched case with no QC assigned needs one picked here.
  const needsQcAssignment = useMemo(() => {
    if (!isDesigner) return false;
    return rows.some((r) => {
      if (!r.matchedCaseId) return false;
      const c = casesById.get(r.matchedCaseId);
      return !!c && !c.qcId;
    });
  }, [isDesigner, rows, casesById]);

  const resetAndClose = useCallback(() => {
    // Purge any still-staged objects the user never confirmed.
    for (const r of rows) {
      if (r.storageKey) {
        fetch("/api/cases/bulk/upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageKey: r.storageKey }),
        }).catch(() => {});
      }
      if (r.previewStorageKey) {
        fetch("/api/cases/bulk/upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageKey: r.previewStorageKey }),
        }).catch(() => {});
      }
    }
    setRows([]);
    setEligibleCases([]);
    setSelectedQcId("");
    setMinimized(false);
    onOpenChange(false);
  }, [rows, onOpenChange]);

  const handleConfirm = useCallback(async () => {
    const ready = rows.filter((r) => r.storageKey && r.matchedCaseId);
    const unresolved = rows.filter((r) => r.storageKey && !r.matchedCaseId);
    if (ready.length === 0) {
      toast.error("No matched files to send. Assign cases or remove unmatched files.");
      return;
    }
    if (unresolved.length > 0) {
      toast.error(`${unresolved.length} file(s) have no case assigned. Assign or remove them first.`);
      return;
    }
    // Prevent two files targeting the same case.
    const seen = new Set<string>();
    for (const r of ready) {
      if (seen.has(r.matchedCaseId!)) {
        toast.error("Two files are assigned to the same case. Please resolve duplicates.");
        return;
      }
      seen.add(r.matchedCaseId!);
    }

    // Designers can't send to QC until every matched case has a QC — either already
    // assigned on the case or picked here for the ones that don't.
    if (needsQcAssignment && !selectedQcId) {
      toast.error("Assign a QC before sending. Select a QC lead below.");
      return;
    }

    setIsConfirming(true);
    try {
      const res = await fetch("/api/cases/bulk/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qcId: isDesigner ? (selectedQcId || null) : null,
          items: ready.map((r) => ({
            caseId: r.matchedCaseId,
            storageKey: r.storageKey,
            fileName: r.fileName,
            fileType: r.fileType,
            fileSize: r.fileSize,
            note: r.note.trim() || null,
            previewStorageKey: r.previewStorageKey,
            previewFileName: r.previewFileName,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Confirmation failed");

      const results: Array<{ caseId: string; ok: boolean; error?: string }> = data.results ?? [];
      const okIds = new Set(results.filter((x) => x.ok).map((x) => x.caseId));
      const failed = results.filter((x) => !x.ok);

      if (okIds.size > 0) toast.success(`${okIds.size} case(s) sent to ${routesTo}.`);
      if (failed.length > 0) toast.error(`${failed.length} case(s) failed: ${failed[0].error ?? "error"}`);

      // Drop confirmed rows; keep failures for retry.
      setRows((prev) => prev.filter((r) => !(r.matchedCaseId && okIds.has(r.matchedCaseId))));
      if (okIds.size > 0) onCompleted?.();
      if (failed.length === 0) resetAndClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setIsConfirming(false);
    }
  }, [rows, routesTo, onCompleted, resetAndClose, needsQcAssignment, selectedQcId, isDesigner]);

  const uploadedCount = rows.filter((r) => !r.isUploading).length;

  return (
    <>
    <Dialog
      open={open && !minimized}
      onOpenChange={(o) => {
        if (o) { onOpenChange(o); return; }
        // Closing mid-upload minimizes instead of discarding the in-flight batch.
        if (anyUploading || isConfirming) setMinimized(true);
        else resetAndClose();
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle>Bulk Upload Design Output</DialogTitle>
            {rows.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setMinimized(true)}
                title="Minimize — uploads continue in the background"
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
          </div>
          <DialogDescription>
            Drop finished output files. Each is matched to an in-progress case by its original
            scan file name. Confirmed cases are sent to <span className="font-medium">{routesTo}</span>.
          </DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"
          }`}
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-foreground">Drag & drop output files here, or click to browse</p>
          <p className="text-xs text-muted-foreground">Multiple files supported</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files ?? []); e.target.value = ""; }}
          />
        </div>

        <input
          ref={previewFileInputRef}
          type="file"
          accept={PREVIEW_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && activePreviewRowId) addPreviewFile(activePreviewRowId, file);
            e.target.value = "";
            setActivePreviewRowId(null);
          }}
        />

        {/* Results table */}
        {rows.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">File</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Matched Case</th>
                  <th className="px-3 py-2 text-left font-medium">Preview</th>
                  <th className="px-3 py-2 text-left font-medium">Note</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = STATUS_META[row.matchStatus];
                  const options = row.candidateIds.length > 0
                    ? row.candidateIds.map((id) => casesById.get(id)).filter(Boolean) as EligibleCase[]
                    : eligibleCases;
                  return (
                    <tr key={row.tempId} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground break-all">{row.fileName}</div>
                        {row.isUploading && (
                          <div className="mt-1 h-1.5 w-32 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${row.uploadProgress}%` }} />
                          </div>
                        )}
                        {row.uploadError && <div className="mt-1 text-destructive">{row.uploadError}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={meta.variant}>{row.isUploading ? "Uploading…" : meta.label}</Badge>
                      </td>
                      <td className="px-3 py-2 min-w-[220px]">
                        {row.isUploading || row.uploadError ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Select
                            value={row.matchedCaseId ?? ""}
                            onValueChange={(v) => patchRow(row.tempId, { matchedCaseId: v })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select a case…" />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((c) => (
                                <SelectItem key={c.id} value={c.id} className="text-xs">
                                  {c.caseNumber ?? c.id.slice(0, 8)} · {c.clientDisplayName ?? "—"}
                                  {c.scanFileName ? ` · ${c.scanFileName}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="px-3 py-2 min-w-[160px]">
                        {!row.matchedCaseId ? (
                          <span className="text-muted-foreground">Assign a case first</span>
                        ) : row.previewIsUploading ? (
                          <div className="w-32">
                            <div className="truncate text-foreground">{row.previewFileName}</div>
                            <div className="mt-1 h-1.5 w-32 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-primary transition-all" style={{ width: `${row.previewUploadProgress}%` }} />
                            </div>
                          </div>
                        ) : row.previewStorageKey ? (
                          <div className="flex items-center gap-1.5">
                            <span className="truncate max-w-[100px]" title={row.previewFileName ?? undefined}>{row.previewFileName}</span>
                            <button
                              type="button"
                              onClick={() => removePreviewFile(row)}
                              className="text-muted-foreground hover:text-destructive"
                              title="Remove preview file"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setActivePreviewRowId(row.tempId); previewFileInputRef.current?.click(); }}
                            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            title="Attach preview file (HTML or image)"
                          >
                            <Paperclip className="h-3.5 w-3.5" /> Add preview
                          </button>
                        )}
                        {row.previewUploadError && <div className="mt-1 text-destructive">{row.previewUploadError}</div>}
                      </td>
                      <td className="px-3 py-2 min-w-[160px]">
                        <Input
                          value={row.note}
                          onChange={(e) => patchRow(row.tempId, { note: e.target.value })}
                          placeholder="Case note (optional)"
                          className="h-8 text-xs"
                          disabled={row.isUploading || !!row.uploadError}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeRow(row)}
                          className="text-muted-foreground hover:text-destructive"
                          title="Remove file"
                        >
                          {row.matchStatus === "unmatched" ? <Trash2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter className="gap-2 pb-2 sm:items-center">
          {isDesigner && needsQcAssignment && (
            <div className="mr-auto flex items-center gap-2">
              <span className={`text-xs font-semibold whitespace-nowrap ${!selectedQcId ? "text-green-600" : "text-muted-foreground"}`}>Assign QC</span>
              <Select value={selectedQcId} onValueChange={setSelectedQcId}>
                <SelectTrigger className={`h-8 w-[200px] text-xs ${!selectedQcId ? "border-green-500 ring-1 ring-green-500/40 text-green-700" : ""}`}>
                  <SelectValue placeholder="Select QC lead…" />
                </SelectTrigger>
                <SelectContent>
                  {qcOptions.map((qc) => (
                    <SelectItem key={qc.id} value={qc.id} className="text-xs">{qc.name}</SelectItem>
                  ))}
                  {qcOptions.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No active QC leads found.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="ghost" onClick={resetAndClose} disabled={isConfirming}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={isConfirming || anyUploading || isMatching || rows.length === 0}
          >
            {isConfirming ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : sendLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Minimized indicator — uploads keep running; click to restore the modal. */}
    {open && minimized && (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-xs font-medium text-foreground shadow-lg hover:bg-accent transition-colors"
        title="Restore bulk upload"
      >
        {anyUploading || isMatching || isConfirming ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {isConfirming ? "Sending…" : isMatching ? "Matching cases…" : `Uploading ${uploadedCount}/${rows.length}…`}
          </>
        ) : (
          <>
            <UploadCloud className="h-4 w-4 text-primary" />
            {rows.length} file(s) ready — click to review
          </>
        )}
      </button>
    )}
    </>
  );
}
