"use client"

import React, { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ChevronLeft,
  ChevronRight,
  FileArchive,
  Loader2,
  Upload,
  X,
  AlertTriangle,
  Info,
} from "lucide-react"
import { Button } from "@/src/components/ui/button"
import { uploadFileInChunks } from "@/src/lib/upload-utils"
import type { ThreeShapeCase, DataQualityWarning } from "@/src/lib/three-shape/model"
import { DraftCaseForm, type DraftSubTypeData } from "./DraftCaseForm"
import { draftValid, highlightFields, isForced, openWarnings } from "./draft-logic"

type UploadedRef = { fileUrl: string; fileName: string; fileSize: number; fileType: string }

interface UploadRow {
  id: string
  file: File
  fileName: string
  progress: number
  status: "uploading" | "done" | "error"
  result?: UploadedRef
  error?: string
}

interface ExtractApiResult {
  ok: boolean
  packageName: string
  error?: { code: string; message: string }
  draft?: {
    category: string | null
    scriptCategory: string
    subTypeData: DraftSubTypeData
    warnings: DataQualityWarning[]
  }
  threeShape?: ThreeShapeCase
  duplicateOf?: { caseId: string; caseNumber: string | null; status: string } | null
}

interface DraftState {
  packageName: string
  ok: boolean
  error?: { code: string; message: string }
  category: string | null
  subTypeData: DraftSubTypeData
  warnings: DataQualityWarning[]
  requiresReview: boolean
  duplicateOf: { caseId: string; caseNumber: string | null; status: string } | null
  skip: boolean
  threeShape: ThreeShapeCase | null
  sourceZip: UploadedRef
}

const MAX_FILES = 5

interface ThreeShapeImportProps {
  /** Called after cases are created so the list refreshes. */
  onSubmitted: () => void
  /** Called to close the parent dialog. */
  onClose: () => void
}

export function ThreeShapeImport({ onSubmitted, onClose }: ThreeShapeImportProps) {
  const [phase, setPhase] = useState<"upload" | "extracting" | "review">("upload")
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [drafts, setDrafts] = useState<DraftState[]>([])
  const [current, setCurrent] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const anyUploading = uploads.some((u) => u.status === "uploading")
  const uploadedOk = uploads.filter((u) => u.status === "done")
  const uploadErrors = uploads.filter((u) => u.status === "error")
  // Proceed with whatever uploaded — a single failed upload shouldn't block the rest.
  const canExtract = uploadedOk.length > 0 && !anyUploading

  const onFiles = (fileList: FileList | null) => {
    if (!fileList) return
    const picked = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".zip"))
    if (picked.length === 0) {
      toast.error("3Shape import accepts .zip files only.")
      return
    }
    const room = MAX_FILES - uploads.length
    if (room <= 0) {
      toast.error(`You can import at most ${MAX_FILES} zip files at a time.`)
      return
    }
    if (picked.length > room) {
      toast.warning(`Only ${room} more file${room === 1 ? "" : "s"} can be added (max ${MAX_FILES}).`)
    }
    const rows: UploadRow[] = picked.slice(0, room).map((file) => ({
      id: crypto.randomUUID(),
      file,
      fileName: file.name,
      progress: 0,
      status: "uploading",
    }))
    setUploads((prev) => [...prev, ...rows])

    for (const row of rows) {
      uploadFileInChunks(
        row.file,
        {},
        (progress) =>
          setUploads((prev) => prev.map((u) => (u.id === row.id ? { ...u, progress } : u))),
        (res: UploadedRef) =>
          setUploads((prev) =>
            prev.map((u) =>
              u.id === row.id ? { ...u, status: "done", progress: 100, result: res } : u,
            ),
          ),
        (err: string) =>
          setUploads((prev) =>
            prev.map((u) => (u.id === row.id ? { ...u, status: "error", error: err } : u)),
          ),
      )
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const removeUpload = (id: string) => setUploads((prev) => prev.filter((u) => u.id !== id))

  const runExtract = async () => {
    const files = uploads.filter((u) => u.result).map((u) => u.result as UploadedRef)
    if (files.length === 0) return
    setPhase("extracting")
    try {
      const res = await fetch("/api/cases/xml-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || "Extraction failed.")
        setPhase("upload")
        return
      }
      const byName = new Map(files.map((f) => [f.fileName, f]))
      // The route returns results in the same order as `files`; fall back to
      // name only if that ever changes.
      const next: DraftState[] = (json.results as ExtractApiResult[]).map((r, i) => {
        const sourceZip = (files[i] ?? byName.get(r.packageName)) as UploadedRef
        if (!r.ok || !r.draft) {
          return {
            packageName: r.packageName,
            ok: false,
            error: r.error ?? { code: "UNKNOWN", message: "Could not read this package." },
            category: null,
            subTypeData: { teeth: [], toothSystem: "USA", notes: "" },
            warnings: [],
            requiresReview: true,
            // An unreadable package can't be submitted as-is, so it starts
            // skipped (keeps it out of `submittable` and the validate-before-
            // submit sweep). The user can still "Fill in manually".
            skip: true,
            duplicateOf: null,
            threeShape: null,
            sourceZip,
          }
        }
        return {
          packageName: r.packageName,
          ok: true,
          category: r.draft.category,
          subTypeData: {
            toothSystem: "USA",
            notes: "",
            ...r.draft.subTypeData,
            teeth: Array.isArray(r.draft.subTypeData.teeth) ? r.draft.subTypeData.teeth : [],
          },
          warnings: r.threeShape?.dataQuality.warnings ?? r.draft.warnings ?? [],
          requiresReview: r.threeShape?.dataQuality.requiresReview ?? true,
          duplicateOf: r.duplicateOf ?? null,
          skip: Boolean(r.duplicateOf),
          threeShape: r.threeShape ?? null,
          sourceZip,
        }
      })
      setDrafts(next)
      setCurrent(0)
      setPhase("review")
    } catch {
      toast.error("Extraction failed — please try again.")
      setPhase("upload")
    }
  }

  const patchDraft = (
    idx: number,
    patch: Partial<DraftState> | ((d: DraftState) => Partial<DraftState>),
  ) =>
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === idx ? { ...d, ...(typeof patch === "function" ? patch(d) : patch) } : d,
      ),
    )

  const submittable = useMemo(() => drafts.filter((d) => d.ok && !d.skip), [drafts])

  const submitAll = async () => {
    if (submitting) return
    if (submittable.length === 0) {
      toast.error("Nothing to submit — every draft is skipped or errored.")
      return
    }
    const firstInvalid = drafts.findIndex((d) => !draftValid(d))
    if (firstInvalid !== -1) {
      setCurrent(firstInvalid)
      toast.error("Complete the highlighted fields on every case before submitting.")
      return
    }

    setSubmitting(true)
    try {
      const body = submittable.map((d) => ({
        category: d.category,
        subTypeData: { ...d.subTypeData, threeShape: d.threeShape },
        uploadedFile: d.sourceZip,
        uploadedFiles: [d.sourceZip],
        preferredTeethLibrary: "default",
        // A duplicate the user chose to keep → force it past both server
        // guards; otherwise let the server soft-skip a name+tooth match.
        ...(isForced(d) ? { forceCreate: true } : { skipIfDuplicate: true }),
      }))
      const form = new FormData()
      form.append("cases", JSON.stringify(body))
      const res = await fetch("/api/cases", { method: "POST", body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || "Failed to create cases.")
        return
      }
      const created = Array.isArray(json.data) ? json.data.length : json.data ? 1 : 0
      const skippedCount = Array.isArray(json.skipped) ? json.skipped.length : 0
      toast.success(
        `${created} case${created === 1 ? "" : "s"} created` +
          (skippedCount ? `, ${skippedCount} skipped as duplicate` : ""),
      )
      onSubmitted()
      onClose()
    } catch {
      toast.error("An error occurred while creating cases.")
    } finally {
      setSubmitting(false)
    }
  }

  /* ----------------------------- render ----------------------------- */

  if (phase === "upload" || phase === "extracting") {
    return (
      <div className="space-y-4 mt-2">
        <p className="text-xs text-muted-foreground">
          Drop up to {MAX_FILES} <span className="font-semibold">3Shape DentalContainer</span> zip
          exports. Each zip is one case — we&apos;ll read the order XML and pre-fill the form for you
          to review.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />

        {uploads.length === 0 ? (
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              onFiles(e.dataTransfer.files)
            }}
            className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-emerald-700 transition-colors block"
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium text-foreground">Select 3Shape zip files</p>
            <p className="text-xs text-muted-foreground mt-1">.zip only · up to {MAX_FILES}</p>
            <input type="file" accept=".zip" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </label>
        ) : (
          <div className="space-y-2">
            {uploads.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-3 p-2.5 border border-zinc-200 rounded-md bg-white"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileArchive className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-800 truncate max-w-[320px]">
                      {u.fileName}
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      {u.status === "uploading" && `Uploading… ${u.progress}%`}
                      {u.status === "done" && "✓ Uploaded"}
                      {u.status === "error" && <span className="text-red-500">{u.error || "Upload failed"}</span>}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-400 hover:text-red-500 hover:bg-red-50 shrink-0"
                  disabled={phase === "extracting"}
                  onClick={() => removeUpload(u.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {uploads.length < MAX_FILES && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={phase === "extracting"}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3 mr-1.5" /> Add more
              </Button>
            )}
          </div>
        )}

        {uploadErrors.length > 0 && !anyUploading && (
          <p className="text-[11px] text-amber-600">
            {uploadErrors.length} file{uploadErrors.length === 1 ? "" : "s"} failed to upload and
            will be skipped — remove and re-add {uploadErrors.length === 1 ? "it" : "them"} to retry.
          </p>
        )}

        <Button
          className="w-full bg-emerald-800 text-white hover:bg-emerald-900 h-9 text-xs font-semibold"
          disabled={!canExtract || phase === "extracting"}
          onClick={runExtract}
        >
          {phase === "extracting" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Reading {uploadedOk.length}{" "}
              package{uploadedOk.length === 1 ? "" : "s"}…
            </>
          ) : (
            `Extract ${uploadedOk.length || ""} package${uploadedOk.length === 1 ? "" : "s"}`.trim()
          )}
        </Button>
      </div>
    )
  }

  // ---- review carousel ----
  const d = drafts[current]
  if (!d) return null

  // Field warnings drop out of the list (and lose their amber ring) once the
  // user fills the field — see draft-logic.ts.
  const openW = openWarnings(d)
  const flagged = highlightFields(d)

  return (
    <div className="space-y-4 mt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous case"
            className="h-7 w-7"
            disabled={current === 0}
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-semibold text-gray-700 tabular-nums">
            {current + 1} / {drafts.length}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next case"
            className="h-7 w-7"
            disabled={current === drafts.length - 1}
            onClick={() => setCurrent((c) => Math.min(drafts.length - 1, c + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground truncate max-w-[45%]" title={d.packageName}>
          {d.packageName}
        </p>
      </div>

      {/* thumbnail rail */}
      <div className="flex gap-1 flex-wrap">
        {drafts.map((dd, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setCurrent(i)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              i === current
                ? "border-emerald-600 bg-emerald-50 text-emerald-800 font-semibold"
                : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
            }`}
          >
            {dd.skip ? "skip · " : ""}
            {dd.ok ? dd.category ?? "?" : "error"}
            {dd.ok && dd.warnings.length > 0 ? ` (${dd.warnings.length})` : ""}
          </button>
        ))}
      </div>

      {!d.ok ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> Couldn&apos;t read this package
          </p>
          <p className="text-xs text-red-700">{d.error?.message}</p>
          <p className="text-[11px] text-red-600">
            This zip is skipped. Fix it and re-upload — or fill the case in by hand and it&apos;ll
            still be attached to this zip.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs bg-white"
            onClick={() =>
              patchDraft(current, {
                ok: true,
                error: undefined,
                skip: false,
                category: null,
                subTypeData: {
                  teeth: [],
                  toothSystem: "USA",
                  notes: `Imported from ${d.packageName} — the 3Shape XML could not be read, so every field was entered manually.`,
                },
                warnings: [],
                requiresReview: true,
                threeShape: null,
              })
            }
          >
            Fill in manually
          </Button>
        </div>
      ) : (
        <>
          {d.duplicateOf && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={d.skip}
                onChange={(e) => patchDraft(current, { skip: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-amber-400 text-emerald-600"
              />
              <span className="text-xs text-amber-800">
                <span className="font-semibold">Looks like a duplicate</span> of{" "}
                {d.duplicateOf.caseNumber || "an existing case"} — same file name and overlapping
                teeth on a case that&apos;s still in progress. Leave checked to skip it, or uncheck to
                create it anyway.
              </span>
            </label>
          )}

          {openW.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-800 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" /> Review these — the file didn&apos;t give us enough
              </p>
              <ul className="mt-1 space-y-0.5">
                {openW.map((w, i) => (
                  <li key={i} className="text-[11px] text-amber-700">
                    • {w.message}
                    {w.resolution ? <span className="text-amber-600"> — {w.resolution}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DraftCaseForm
            category={d.category}
            subTypeData={d.subTypeData}
            highlightFields={flagged}
            disabled={d.skip || submitting}
            onCategoryChange={(category) =>
              patchDraft(current, (prev) => ({
                category,
                // Keep the tooth selections — UNN is valid across categories —
                // but drop the old category's sub-type fields and the
                // extraction warnings (the user has taken over this call).
                subTypeData: {
                  teeth: Array.isArray(prev.subTypeData.teeth) ? prev.subTypeData.teeth : [],
                  crownBridgeTeeth: Array.isArray(prev.subTypeData.crownBridgeTeeth)
                    ? prev.subTypeData.crownBridgeTeeth
                    : [],
                  toothSystem: prev.subTypeData.toothSystem ?? "USA",
                  notes: typeof prev.subTypeData.notes === "string" ? prev.subTypeData.notes : "",
                  modelRequired: category === "3D Model" ? undefined : "no",
                },
                warnings: [],
                requiresReview: false,
              }))
            }
            onSubTypeDataChange={(subTypeData) => patchDraft(current, { subTypeData })}
          />

          {d.threeShape && <SourcePanel threeShape={d.threeShape} />}
        </>
      )}

      <Button
        className="w-full bg-emerald-800 text-white hover:bg-emerald-900 h-9 text-xs font-semibold"
        disabled={submitting}
        onClick={submitAll}
      >
        {submitting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Creating cases…
          </>
        ) : (
          `Submit ${submittable.length} case${submittable.length === 1 ? "" : "s"}`
        )}
      </Button>
    </div>
  )
}

/* ---------------- "from the package" read-only panel ---------------- */

function SourcePanel({ threeShape }: { threeShape: ThreeShapeCase }) {
  const [open, setOpen] = useState(false)
  const c = threeShape
  const rows: Array<[string, string | null]> = [
    ["Source order", c.sourceIds.sourceOrderId],
    ["Lab / customer", c.order.customer],
    ["Manufacturer", c.order.manufacturerName],
    ["Indication", c.order.rawItems],
    ["Teeth (UNN)", c.classification.toothNumbers.length ? `#${c.classification.toothNumbers.join(", #")}` : null],
    [
      "Components",
      c.classification.components.length
        ? c.classification.components.map((x) => `${x.type} (${x.toothNumbers.join(",")})`).join("  ·  ")
        : null,
    ],
    ["Connector spans", c.relationships.connectorSpans.length ? c.relationships.connectorSpans.map((s) => s.join("-")).join(", ") : null],
    ["Scans", c.scans.length ? c.scans.map((s) => s.normalizedScanType).join(", ") : null],
    ["Scanned", c.timestamps.maxScanDate ? new Date(c.timestamps.maxScanDate).toLocaleDateString() : null],
    ["Lab instructions", c.order.comments],
  ]
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 text-[11px] font-semibold text-zinc-600 flex items-center justify-between"
      >
        From the 3Shape package
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <dl className="px-3 pb-3 space-y-1">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[11px]">
                <dt className="text-zinc-500 shrink-0 w-28">{k}</dt>
                <dd className="text-zinc-700 whitespace-pre-wrap wrap-break-word">{v}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  )
}
