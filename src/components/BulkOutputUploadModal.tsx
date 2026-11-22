"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { UploadCloud, X, Trash2, Loader2, Minus, Paperclip, ChevronDown, Search, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { uploadBulkFile } from "@/src/lib/upload-utils";
import {
  looseKey,
  matchFileToCase,
  needsNameOverride,
  similarity,
  type MatchStatus as ServerMatchStatus,
  type MatchTier,
} from "@/src/lib/bulk-output-matching";

interface EligibleCase {
  id: string;
  caseNumber: string | null;
  category: string | null;
  scanFileNames: string[];
  clientDisplayName: string | null;
  qcId: string | null;
}

interface QcOption {
  id: string;
  name: string;
}

interface PreviewFile {
  previewId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  isUploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
  storageKey: string | null;
}

type UploadState = "waiting" | "uploading" | "done" | "error";

interface Row {
  tempId: string;
  file: File;
  fileName: string;
  fileType: string;
  fileSize: number;
  // upload state — files only upload once they have (or are likely to get) a case
  uploadState: UploadState;
  uploadProgress: number;
  uploadError: string | null;
  storageKey: string | null;
  // match state
  matchStatus: ServerMatchStatus | "matching";
  matchTier: MatchTier | null;
  candidateIds: string[];
  matchedCaseId: string | null;
  /** The case was picked by the user rather than auto-matched. */
  manualChoice: boolean;
  /** The user confirmed attaching this file even though its name doesn't match the case. */
  nameOverride: boolean;
  note: string;
  // preview files (optional, only offered once a case is matched; max MAX_PREVIEW_FILES)
  previewFiles: PreviewFile[];
}

const PREVIEW_EXTENSIONS = [".html", ".htm", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".svg", ".heic", ".heif", ".ico", ".stl", ".ply", ".obj", ".dcm", ".off", ".3mf", ".glb", ".gltf"];
const MAX_PREVIEW_FILES = 5;
const MAX_PREVIEW_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
const MAX_PICKER_RESULTS = 50;

function validatePreviewFile(file: File): { isValid: boolean; error?: string } {
  const dot = file.name.lastIndexOf(".");
  const ext = dot !== -1 ? file.name.substring(dot).toLowerCase() : "";
  if (!PREVIEW_EXTENSIONS.includes(ext)) {
    return { isValid: false, error: "Only HTML, image, or 3D files (.stl, .ply, .obj, .dcm) are allowed for preview." };
  }
  if (file.size > MAX_PREVIEW_FILE_SIZE) {
    return { isValid: false, error: "Preview file exceeds the 1GB limit." };
  }
  return { isValid: true };
}

let previewIdCounter = 0;
const nextPreviewId = () => `bulk-preview-${Date.now()}-${previewIdCounter++}`;

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

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const TIER_LABEL: Record<MatchTier, string> = {
  exact: "Matched",
  normalized: "Close match",
  "case-number": "Case number",
  similar: "Suggested",
};

function caseLabel(c: EligibleCase): string {
  return `${c.caseNumber ?? c.id.slice(0, 8)} · ${c.clientDisplayName ?? "—"}`;
}

const deleteStaged = (storageKey: string | null) => {
  if (!storageKey) return;
  fetch("/api/cases/bulk/upload", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storageKey }),
  }).catch(() => {});
};

export function BulkOutputUploadModal({ open, onOpenChange, userRole, qcOptions = [], onCompleted }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [eligibleCases, setEligibleCases] = useState<EligibleCase[]>([]);
  const [matchingCount, setMatchingCount] = useState(0);
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
  const isMatching = matchingCount > 0;

  const patchRow = useCallback((tempId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)));
  }, []);

  const startUpload = useCallback((tempId: string, file: File) => {
    patchRow(tempId, { uploadState: "uploading", uploadProgress: 0, uploadError: null });
    uploadBulkFile(file, (p) => patchRow(tempId, { uploadProgress: p }))
      .then((res) => patchRow(tempId, { uploadState: "done", uploadProgress: 100, storageKey: res.storageKey }))
      .catch((err: unknown) => patchRow(tempId, {
        uploadState: "error",
        uploadError: err instanceof Error ? err.message : "Upload failed",
      }));
  }, [patchRow]);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const newRows: Row[] = files.map((f) => ({
      tempId: nextId(),
      file: f,
      fileName: f.name,
      fileType: f.type || "application/octet-stream",
      fileSize: f.size,
      uploadState: "waiting",
      uploadProgress: 0,
      uploadError: null,
      storageKey: null,
      matchStatus: "matching",
      matchTier: null,
      candidateIds: [],
      matchedCaseId: null,
      manualChoice: false,
      nameOverride: false,
      note: "",
      previewFiles: [],
    }));
    setRows((prev) => [...prev, ...newRows]);

    // Match by NAME first — nothing is uploaded yet, so a wrong file costs no bandwidth.
    setMatchingCount((n) => n + 1);
    try {
      const res = await fetch("/api/cases/bulk/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: newRows.map((r) => ({ tempId: r.tempId, fileName: r.fileName })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Matching failed");

      setEligibleCases(data.eligibleCases ?? []);
      const byId = new Map<string, { status: ServerMatchStatus; matchedCaseId: string | null; tier: MatchTier | null; candidateIds: string[] }>();
      for (const r of data.results ?? []) byId.set(r.tempId, r);

      // Only the rows of THIS drop are updated — earlier rows (and choices made on them) stay untouched.
      setRows((prev) => prev.map((row) => {
        const m = byId.get(row.tempId);
        return m
          ? { ...row, matchStatus: m.status, matchTier: m.tier, matchedCaseId: m.matchedCaseId, candidateIds: m.candidateIds ?? [] }
          : row;
      }));
      // Files with a confident (or one-of-a-few) case start uploading now; the rest wait for a case.
      for (const row of newRows) {
        const m = byId.get(row.tempId);
        if (m && (m.status === "matched" || m.status === "ambiguous")) startUpload(row.tempId, row.file);
      }
    } catch (err) {
      setRows((prev) => prev.map((row) => (
        newRows.some((n) => n.tempId === row.tempId) ? { ...row, matchStatus: "unmatched" } : row
      )));
      toast.error(err instanceof Error ? err.message : "Matching failed");
    } finally {
      setMatchingCount((n) => n - 1);
    }
  }, [startUpload]);

  const assignCase = useCallback((row: Row, caseId: string) => {
    patchRow(row.tempId, { matchedCaseId: caseId, manualChoice: true, nameOverride: false });
    if (row.uploadState === "waiting") startUpload(row.tempId, row.file);
  }, [patchRow, startUpload]);

  const removeRow = useCallback((row: Row) => {
    // Best-effort purge of the staged objects from R2.
    deleteStaged(row.storageKey);
    for (const preview of row.previewFiles) deleteStaged(preview.storageKey);
    setRows((prev) => prev.filter((r) => r.tempId !== row.tempId));
  }, []);

  const patchPreviewFile = useCallback((tempId: string, previewId: string, patch: Partial<PreviewFile>) => {
    setRows((prev) => prev.map((r) => (
      r.tempId === tempId
        ? { ...r, previewFiles: r.previewFiles.map((p) => (p.previewId === previewId ? { ...p, ...patch } : p)) }
        : r
    )));
  }, []);

  const addPreviewFiles = useCallback((tempId: string, fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setRows((prev) => {
      const row = prev.find((r) => r.tempId === tempId);
      if (!row) return prev;
      const remaining = MAX_PREVIEW_FILES - row.previewFiles.length;
      if (remaining <= 0) {
        toast.error(`A case can have at most ${MAX_PREVIEW_FILES} preview files.`);
        return prev;
      }

      const accepted: File[] = [];
      for (const file of files) {
        if (accepted.length >= remaining) {
          toast.error(`Only ${remaining} more preview file(s) can be added (max ${MAX_PREVIEW_FILES}).`);
          break;
        }
        const check = validatePreviewFile(file);
        if (!check.isValid) {
          toast.error(check.error || "Invalid preview file");
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length === 0) return prev;

      const newPreviews: PreviewFile[] = accepted.map((f) => ({
        previewId: nextPreviewId(),
        fileName: f.name,
        fileType: f.type || "application/octet-stream",
        fileSize: f.size,
        isUploading: true,
        uploadProgress: 0,
        uploadError: null,
        storageKey: null,
      }));

      accepted.forEach((file, i) => {
        const previewId = newPreviews[i].previewId;
        uploadBulkFile(file, (p) => patchPreviewFile(tempId, previewId, { uploadProgress: p }))
          .then((res) => patchPreviewFile(tempId, previewId, { isUploading: false, uploadProgress: 100, storageKey: res.storageKey }))
          .catch((err: unknown) => patchPreviewFile(tempId, previewId, {
            isUploading: false,
            uploadError: err instanceof Error ? err.message : "Upload failed",
          }));
      });

      return prev.map((r) => (r.tempId === tempId ? { ...r, previewFiles: [...r.previewFiles, ...newPreviews] } : r));
    });
  }, [patchPreviewFile]);

  const removePreviewFile = useCallback((row: Row, previewId: string) => {
    deleteStaged(row.previewFiles.find((p) => p.previewId === previewId)?.storageKey ?? null);
    patchRow(row.tempId, { previewFiles: row.previewFiles.filter((p) => p.previewId !== previewId) });
  }, [patchRow]);

  const casesById = useMemo(() => {
    const m = new Map<string, EligibleCase>();
    for (const c of eligibleCases) m.set(c.id, c);
    return m;
  }, [eligibleCases]);

  // How many rows point at each case — two files can't both become a case's output.
  const caseUseCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.matchedCaseId) counts.set(r.matchedCaseId, (counts.get(r.matchedCaseId) ?? 0) + 1);
    return counts;
  }, [rows]);

  const rowIssues = useCallback((row: Row) => {
    const selected = row.matchedCaseId ? casesById.get(row.matchedCaseId) : undefined;
    return {
      selected,
      isDuplicate: !!row.matchedCaseId && (caseUseCount.get(row.matchedCaseId) ?? 0) > 1,
      needsOverride: !!selected && needsNameOverride(row.fileName, selected),
    };
  }, [casesById, caseUseCount]);

  const anyUploading = rows.some((r) => r.uploadState === "uploading" || r.previewFiles.some((p) => p.isUploading));

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
      deleteStaged(r.storageKey);
      for (const preview of r.previewFiles) deleteStaged(preview.storageKey);
    }
    setRows([]);
    setEligibleCases([]);
    setSelectedQcId("");
    setMinimized(false);
    onOpenChange(false);
  }, [rows, onOpenChange]);

  const handleConfirm = useCallback(async () => {
    const unassigned = rows.filter((r) => !r.matchedCaseId);
    if (unassigned.length > 0) {
      toast.error(`${unassigned.length} file(s) have no case assigned. Assign or remove them first.`);
      return;
    }
    if (rows.some((r) => rowIssues(r).isDuplicate)) {
      toast.error("Two files are assigned to the same case. Please resolve duplicates.");
      return;
    }
    const unconfirmedNames = rows.filter((r) => rowIssues(r).needsOverride && !r.nameOverride);
    if (unconfirmedNames.length > 0) {
      toast.error(`${unconfirmedNames.length} file name(s) don't match their case. Tick "Use anyway" or pick another case.`);
      return;
    }
    const notUploaded = rows.filter((r) => r.uploadState !== "done" || !r.storageKey);
    if (notUploaded.length > 0) {
      toast.error(`${notUploaded.length} file(s) haven't finished uploading. Retry or remove them first.`);
      return;
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
          items: rows.map((r) => ({
            caseId: r.matchedCaseId,
            storageKey: r.storageKey,
            fileName: r.fileName,
            fileType: r.fileType,
            fileSize: r.fileSize,
            note: r.note.trim() || null,
            nameOverride: r.nameOverride,
            previewFiles: r.previewFiles
              .filter((p) => p.storageKey)
              .map((p) => ({ storageKey: p.storageKey, fileName: p.fileName, fileType: p.fileType, fileSize: p.fileSize })),
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

      // Drop confirmed rows (their staged objects were consumed); keep failures for retry.
      setRows((prev) => prev.filter((r) => !(r.matchedCaseId && okIds.has(r.matchedCaseId))));
      if (okIds.size > 0) onCompleted?.();
      if (failed.length === 0) {
        setRows([]);
        setEligibleCases([]);
        setSelectedQcId("");
        setMinimized(false);
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setIsConfirming(false);
    }
  }, [rows, rowIssues, routesTo, onCompleted, onOpenChange, needsQcAssignment, selectedQcId, isDesigner]);

  const blockedCount = rows.filter((r) => {
    const issues = rowIssues(r);
    return !r.matchedCaseId || issues.isDuplicate || (issues.needsOverride && !r.nameOverride) || r.uploadState === "error";
  }).length;
  const uploadedCount = rows.filter((r) => r.uploadState === "done").length;

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
      <DialogContent
        className="max-w-5xl max-h-[90vh] overflow-y-auto"
        // Escape inside the case search closes only the picker — closing the dialog would discard the batch
        onEscapeKeyDown={(e) => { if ((e.target as HTMLElement | null)?.closest("[data-case-picker]")) e.preventDefault(); }}
      >
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
            Drop finished output files. Each is matched by name to one of <span className="font-medium">your in-progress cases</span>{" "}
            (any of the lab&apos;s scan file names, or the case number). Files upload once they have a case.
            Confirmed cases are sent to <span className="font-medium">{routesTo}</span>.
          </DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Add output files"
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); void addFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
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
            onChange={(e) => { void addFiles(e.target.files ?? []); e.target.value = ""; }}
          />
        </div>

        <input
          ref={previewFileInputRef}
          type="file"
          multiple
          accept={PREVIEW_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length && activePreviewRowId) addPreviewFiles(activePreviewRowId, e.target.files);
            e.target.value = "";
            setActivePreviewRowId(null);
          }}
        />

        {/* Results table */}
        {rows.length > 0 && (
          <div className="rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">File</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Case</th>
                  <th className="px-3 py-2 text-left font-medium">Preview</th>
                  <th className="px-3 py-2 text-left font-medium">Note</th>
                  <th className="px-3 py-2 w-8"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { selected, isDuplicate, needsOverride } = rowIssues(row);
                  const badge = statusBadge(row, isDuplicate, needsOverride);
                  return (
                    <tr key={row.tempId} className="border-t border-border align-top">
                      <td className="px-3 py-2 max-w-[220px]">
                        <div className="font-medium text-foreground break-all">{row.fileName}</div>
                        {row.uploadState === "uploading" && (
                          <div className="mt-1 h-1.5 w-32 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={row.uploadProgress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${row.fileName}`}>
                            <div className="h-full bg-primary transition-all" style={{ width: `${row.uploadProgress}%` }} />
                          </div>
                        )}
                        {row.uploadState === "waiting" && row.matchStatus !== "matching" && (
                          <div className="mt-1 text-muted-foreground">Uploads after you choose a case</div>
                        )}
                        {row.uploadState === "error" && (
                          <div className="mt-1 flex items-center gap-2 text-destructive">
                            <span>{row.uploadError}</span>
                            <button
                              type="button"
                              onClick={() => startUpload(row.tempId, row.file)}
                              className="inline-flex items-center gap-1 text-foreground underline underline-offset-2"
                            >
                              <RotateCcw className="h-3 w-3" /> Retry
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="px-3 py-2 min-w-[260px]">
                        {row.matchStatus === "matching" ? (
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding case…
                          </span>
                        ) : (
                          <div className="space-y-1.5">
                            <CasePicker
                              fileName={row.fileName}
                              cases={eligibleCases}
                              candidateIds={row.candidateIds}
                              value={selected ?? null}
                              onChange={(c) => assignCase(row, c.id)}
                            />
                            {selected && !needsOverride && selected.scanFileNames.length > 0 && (
                              <div className="text-muted-foreground truncate" title={selected.scanFileNames.join(", ")}>
                                Scan: {selected.scanFileNames.join(", ")}
                              </div>
                            )}
                            {isDuplicate && (
                              <div className="flex items-start gap-1 text-destructive">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> Another file is assigned to this case
                              </div>
                            )}
                            {selected && needsOverride && (
                              <label className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900 cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="mt-px"
                                  checked={row.nameOverride}
                                  onChange={(e) => patchRow(row.tempId, { nameOverride: e.target.checked })}
                                />
                                <span>
                                  Name doesn&apos;t match this case&apos;s scan
                                  {selected.scanFileNames.length > 0 && (
                                    <> (<span className="font-mono break-all">{selected.scanFileNames.join(", ")}</span>)</>
                                  )}
                                  . <span className="font-semibold">Use anyway</span>
                                </span>
                              </label>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 min-w-[160px]">
                        {!row.matchedCaseId ? (
                          <span className="text-muted-foreground">Assign a case first</span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {row.previewFiles.map((preview) => (
                              <div key={preview.previewId}>
                                {preview.isUploading ? (
                                  <div className="w-32">
                                    <div className="truncate text-foreground">{preview.fileName}</div>
                                    <div className="mt-1 h-1.5 w-32 rounded-full bg-muted overflow-hidden">
                                      <div className="h-full bg-primary transition-all" style={{ width: `${preview.uploadProgress}%` }} />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate max-w-[100px]" title={preview.fileName}>{preview.fileName}</span>
                                    <button
                                      type="button"
                                      onClick={() => removePreviewFile(row, preview.previewId)}
                                      className="text-muted-foreground hover:text-destructive"
                                      title="Remove preview file"
                                      aria-label={`Remove preview file ${preview.fileName}`}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                                {preview.uploadError && <div className="mt-1 text-destructive">{preview.uploadError}</div>}
                              </div>
                            ))}
                            {row.previewFiles.length < MAX_PREVIEW_FILES && (
                              <button
                                type="button"
                                onClick={() => { setActivePreviewRowId(row.tempId); previewFileInputRef.current?.click(); }}
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                                title="Attach preview file(s) (HTML or image, up to 5)"
                              >
                                <Paperclip className="h-3.5 w-3.5" /> Add preview
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 min-w-[160px]">
                        <Input
                          value={row.note}
                          onChange={(e) => patchRow(row.tempId, { note: e.target.value })}
                          placeholder="Case note (optional)"
                          aria-label={`Note for ${row.fileName}`}
                          className="h-8 text-xs"
                          disabled={row.uploadState === "error"}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeRow(row)}
                          className="text-muted-foreground hover:text-destructive"
                          title="Remove file"
                          aria-label={`Remove ${row.fileName}`}
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

        {rows.length > 0 && blockedCount > 0 && !isMatching && (
          <p className="text-xs text-amber-700" role="status">
            {blockedCount} file(s) need attention before sending.
          </p>
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
            disabled={isConfirming || anyUploading || isMatching || rows.length === 0 || blockedCount > 0}
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

function statusBadge(row: Row, isDuplicate: boolean, needsOverride: boolean): { label: string; variant: BadgeVariant } {
  if (row.matchStatus === "matching") return { label: "Matching…", variant: "outline" };
  if (row.uploadState === "error") return { label: "Upload failed", variant: "destructive" };
  if (isDuplicate) return { label: "Duplicate case", variant: "destructive" };
  if (row.matchedCaseId) {
    if (needsOverride) return { label: row.nameOverride ? "Name override" : "Name mismatch", variant: row.nameOverride ? "secondary" : "destructive" };
    if (row.manualChoice) return { label: "Assigned", variant: "default" };
    return { label: row.matchTier ? TIER_LABEL[row.matchTier] : "Matched", variant: "default" };
  }
  if (row.matchStatus === "ambiguous") return { label: "Choose case", variant: "secondary" };
  if (row.matchStatus === "suggested") return { label: "Suggested", variant: "secondary" };
  return { label: "No match", variant: "destructive" };
}

/**
 * Searchable case picker. Best matches for the file come first, then every other eligible case
 * ranked by name similarity; search covers case number, lab and scan file names.
 */
function CasePicker({
  fileName,
  cases,
  candidateIds,
  value,
  onChange,
}: {
  fileName: string;
  cases: EligibleCase[];
  candidateIds: string[];
  value: EligibleCase | null;
  onChange: (c: EligibleCase) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const ranked = useMemo(() => {
    const fileKey = looseKey(fileName);
    const candidateRank = new Map(candidateIds.map((id, i) => [id, i]));
    return cases
      .map((c) => {
        const match = matchFileToCase(fileName, c);
        const score = Math.max(0, ...c.scanFileNames.map((n) => similarity(fileKey, looseKey(n))));
        return { c, match, score, candidate: candidateRank.get(c.id) };
      })
      .sort((a, b) =>
        (a.candidate ?? Infinity) - (b.candidate ?? Infinity) ||
        b.score - a.score ||
        (a.c.caseNumber ?? "").localeCompare(b.c.caseNumber ?? ""));
  }, [cases, candidateIds, fileName]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? ranked.filter(({ c }) =>
          (c.caseNumber ?? "").toLowerCase().includes(q) ||
          (c.clientDisplayName ?? "").toLowerCase().includes(q) ||
          c.scanFileNames.some((n) => n.toLowerCase().includes(q)))
      : ranked;
    return filtered.slice(0, MAX_PICKER_RESULTS);
  }, [ranked, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (c: EligibleCase) => {
    onChange(c);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} data-case-picker className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setActiveIndex(0); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left text-xs hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>
          {value ? caseLabel(value) : candidateIds.length > 0 ? `Choose from ${candidateIds.length} likely case(s)…` : "Select a case…"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="mt-1 rounded-md border border-border bg-background shadow-md">
          <div className="flex items-center gap-1.5 border-b border-border px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={visible[activeIndex] ? `${listboxId}-${visible[activeIndex].c.id}` : undefined}
              aria-label="Search cases by number, lab or scan file name"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, visible.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); if (visible[activeIndex]) choose(visible[activeIndex].c); }
                else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
              }}
              placeholder="Search case no., lab or scan name"
              className="h-8 w-full bg-transparent text-xs outline-none"
            />
          </div>
          <ul id={listboxId} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {visible.length === 0 && (
              <li className="px-2.5 py-2 text-muted-foreground">
                {cases.length === 0 ? "You have no in-progress cases." : "No cases match your search."}
              </li>
            )}
            {visible.map(({ c, match, candidate }, i) => (
              <li
                key={c.id}
                id={`${listboxId}-${c.id}`}
                role="option"
                aria-selected={value?.id === c.id}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`cursor-pointer px-2.5 py-1.5 ${i === activeIndex ? "bg-accent" : ""} ${value?.id === c.id ? "font-semibold" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{caseLabel(c)}</span>
                  {match && (match.tier !== "similar" || candidate !== undefined) && (
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] text-primary">{TIER_LABEL[match.tier]}</span>
                  )}
                </div>
                {c.scanFileNames.length > 0 && (
                  <div className="truncate text-[11px] text-muted-foreground">{c.scanFileNames.join(", ")}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
