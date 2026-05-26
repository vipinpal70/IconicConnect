"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { ArrowLeft, FileText, MessageSquare, Paperclip, Download } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { StatusBadge } from "@/src/components/StatusBadge"
import { CaseChat } from "@/src/components/CaseChat"
import { CASE_LIFECYCLE_STEPS, CASE_STATUS_TO_LIFECYCLE_STEP } from "@/src/db/schema/case"
import { useState, useRef } from "react"
import { toast } from "sonner"

type CaseRecord = {
  id: string
  caseNumber: string | null
  category: string | null
  subTypeData: Record<string, unknown> | null
  status: string
  designerId: string | null
  qcId: string | null
  accountManagerId: string | null
  designerName?: string | null
  qcName?: string | null
  accountManagerName?: string | null
  dueDate: string | null
  timeline: CaseActivity[]
  createdAt: string
  outputFile?: string | null
  previewFile?: string | null
  outputNote?: string | null
}

type CaseFile = {
  id: string
  fileName: string
  fileUrl: string
  note: string | null
  fileType: string | null
  fileSize: number | null
  createdAt: string
}

type CaseActivity = {
  id: string
  action: string
  label: string
  actor: string
  actionAt: string
}

function renderSubTypeSummary(subTypeData: Record<string, unknown> | null) {
  if (!subTypeData) return "—"

  const values = Object.entries(subTypeData)
    .filter(([key, value]) => key !== "teeth" && key !== "toothSystem" && key !== "notes" && key !== "modelRequired" && typeof value === "string" && value)
    .map(([, value]) => value as string)

  return values.length ? values.join(" - ") : "—"
}

function formatFileSize(size: number | null) {
  if (!size) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/40 py-2 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground text-right">{value}</span>
    </div>
  )
}

function LifecycleStrip({ status }: { status: string }) {
  const currentStep = CASE_STATUS_TO_LIFECYCLE_STEP[status as keyof typeof CASE_STATUS_TO_LIFECYCLE_STEP]
  const currentIndex = Math.max(CASE_LIFECYCLE_STEPS.indexOf(currentStep ?? "Submitted"), 0)

  return (
    <Card className="shadow-card border-emerald-100 bg-[linear-gradient(180deg,rgba(236,253,245,0.9),rgba(240,253,250,0.7))]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-emerald-900">Case Lifecycle</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto pb-2">
          <div className="flex items-center min-w-max">
            {CASE_LIFECYCLE_STEPS.map((step, index) => {
              const done = index < currentIndex || step === currentStep || status === "approved" || status === "delivered"
              const current = step === currentStep

              return (
                <div key={step} className="flex items-center">
                  <div className="flex flex-col items-center min-w-[100px]">
                    <div
                      className={[
                        "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors",
                        done
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-emerald-200 bg-white text-emerald-500",
                        current ? "shadow-[0_0_0_5px_rgba(16,185,129,0.14)]" : "",
                      ].join(" ")}
                    >
                      {done ? "✓" : index + 1}
                    </div>
                    <span
                      className={[
                        "mt-2 px-2 text-center text-[11px] font-medium",
                        done ? "text-emerald-800" : "text-emerald-500",
                      ].join(" ")}
                    >
                      {step}
                    </span>
                  </div>
                  {index < CASE_LIFECYCLE_STEPS.length - 1 && (
                    <div className={`h-1 w-14 rounded-full ${done ? "bg-emerald-500" : "bg-emerald-100"}`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function CaseDetailView({
  caseId,
  backHref,
  shell,
  chatSide,
}: {
  caseId: string
  backHref: string
  shell: (children: React.ReactNode) => React.ReactNode
  chatSide: "lab" | "admin"
}) {
  const router = useRouter()
  const chatRef = useRef<HTMLDivElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const handleStatusChange = async (targetStatus: string) => {
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      })
      if (res.ok) {
        toast.success(`Case status updated successfully!`)
        router.refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to update case status")
      }
    } catch {
      toast.error("Failed to update case status")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRequestChanges = () => {
    chatRef.current?.scrollIntoView({ behavior: "smooth" })
    toast.info("Please scroll down to type your specific feedback inside Case Chat.")
  }

  const { data: caseResponse, isLoading, error } = useQuery<{ data: CaseRecord }>({
    queryKey: ["case", caseId],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to fetch case")
      }
      return res.json()
    },
  })

  const { data: filesResponse } = useQuery<{ data: CaseFile[] }>({
    queryKey: ["case-files", caseId],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/files`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to fetch case files")
      }
      return res.json()
    },
    retry: false,
  })

  const caseRecord = caseResponse?.data
  const files = filesResponse?.data || []
  const activities = caseRecord?.timeline || []
  const wasValidated = activities.some(
    (act) => act.label === "Scan validated" || act.label === "Scan rejected" || act.label.includes("QC") || act.label.includes("designer")
  )

  if (isLoading) {
    return shell(<div className="p-10 text-center text-muted-foreground">Loading case details...</div>)
  }

  if (error || !caseRecord) {
    return shell(
      <div className="p-10 text-center text-muted-foreground">
        {(error as Error | undefined)?.message || "Case not found"}
      </div>
    )
  }

  const subTypeData = caseRecord.subTypeData || {}
  const teeth = Array.isArray(subTypeData.teeth) ? (subTypeData.teeth as number[]) : []
  const toothSystem = typeof subTypeData.toothSystem === "string" ? subTypeData.toothSystem : "USA"
  const notes = typeof subTypeData.notes === "string" ? subTypeData.notes : "—"
  const modelRequired = typeof subTypeData.modelRequired === "string" ? subTypeData.modelRequired : "—"

  return shell(
    <div className="space-y-4 animate-fade-in max-w-6xl mx-auto">
      <div className="flex items-center gap-2.5 flex-wrap">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push(backHref)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold text-foreground leading-none">
            {caseRecord.caseNumber || caseRecord.id}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {caseRecord.category || "—"} · {renderSubTypeSummary(caseRecord.subTypeData)}
          </p>
        </div>
        <div className="ml-auto">
          <StatusBadge status={caseRecord.status} role={chatSide === "admin" ? "internal" : "client"} />
        </div>
      </div>

      <LifecycleStrip status={caseRecord.status} />

      {/* Upper Grid: Details & Timeline side-by-side on lg screen */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-card flex flex-col justify-between">
          <div>
            <CardHeader className="py-2.5 px-4 border-b border-border/50">
              <CardTitle className="text-sm font-semibold">Case Details</CardTitle>
            </CardHeader>
            <CardContent className="mt-2 px-4 pb-3">
              <DetailRow label="Case Number" value={caseRecord.caseNumber || caseRecord.id} />
              <DetailRow label="Category" value={caseRecord.category || "—"} />
              <DetailRow label="Case Sub Type" value={renderSubTypeSummary(caseRecord.subTypeData)} />
              <DetailRow label="Model Required" value={modelRequired} />
              <DetailRow label="Teeth" value={teeth.length ? `#${teeth.join(", #")} (${toothSystem})` : "—"} />
              <DetailRow label="Designer" value={caseRecord.designerName || caseRecord.designerId || "—"} />
              <DetailRow label="QC" value={caseRecord.qcName || caseRecord.qcId || "—"} />
              <DetailRow label="Account Manager" value={caseRecord.accountManagerName || caseRecord.accountManagerId || "—"} />
              <DetailRow
                label="Submitted"
                value={new Date(caseRecord.createdAt).toLocaleDateString()}
              />
              <DetailRow
                label="Due Date"
                value={caseRecord.dueDate ? new Date(caseRecord.dueDate).toLocaleDateString() : "—"}
              />
              <div className="pt-2.5 border-t border-border/50 mt-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{notes}</p>
              </div>
            </CardContent>
          </div>

          {/* Client Self-Serve Contextual Actions */}
          {chatSide === "lab" && (
            <CardContent className="py-3 px-4 border-t border-border/50 bg-muted/5 rounded-b-lg space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Lab Actions</p>
              <div className="flex flex-col gap-2">
                {caseRecord.status === "scan_received" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs font-medium"
                      disabled={isSubmitting}
                      onClick={() => handleStatusChange("on_hold")}
                    >
                      ⏸ Hold Case
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs font-medium"
                      disabled={isSubmitting}
                      onClick={() => handleStatusChange("cancelled")}
                    >
                      🚫 Cancel Case
                    </Button>
                  </div>
                )}
                {["scan_not_verified", "scan_verified"].includes(caseRecord.status) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full text-xs font-medium"
                    disabled={isSubmitting}
                    onClick={() => handleStatusChange("on_hold")}
                  >
                    ⏸ Put Case on Hold
                  </Button>
                )}
                {caseRecord.status === "on_hold" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={isSubmitting}
                      onClick={() => handleStatusChange("scan_received")}
                    >
                      ▶ Resume Case
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs font-medium"
                      disabled={isSubmitting || wasValidated}
                      onClick={() => handleStatusChange("cancelled")}
                      title={wasValidated ? "Cannot cancel case after validation has started" : undefined}
                    >
                      🚫 Cancel Case
                    </Button>
                  </div>
                )}
                {caseRecord.status === "submitted_to_client" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={isSubmitting}
                      onClick={() => handleStatusChange("approved")}
                    >
                      ✓ Approve Case
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs font-medium text-red-600 border-red-200 hover:bg-red-50"
                      onClick={handleRequestChanges}
                    >
                      ✗ Request Changes
                    </Button>
                  </div>
                )}
                {!["scan_received", "scan_not_verified", "scan_verified", "on_hold", "submitted_to_client"].includes(caseRecord.status) && (
                  <p className="text-xs text-muted-foreground italic text-center py-1">No actions available at this stage.</p>
                )}
              </div>
            </CardContent>
          )}
        </Card>

        {/* Activity Timeline Card */}
        <Card className="shadow-card">
          <CardHeader className="py-2.5 px-4 border-b border-border/50">
            <CardTitle className="text-sm font-semibold">Activity Timeline</CardTitle>
          </CardHeader>
          <CardContent className="mt-2 px-4 max-h-[350px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-zinc-200">
            {activities.length === 0 ? (
              <p className="text-xs text-muted-foreground">No activity recorded for this case yet.</p>
            ) : (
              <div className="space-y-4">
                {activities.map((activity, index) => (
                  <div key={activity.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="mt-1 h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-100 shrink-0" />
                      {index < activities.length - 1 && <div className="mt-1.5 w-0.5 flex-1 bg-emerald-200" />}
                    </div>
                    <div className="pb-1">
                      <p className="text-xs font-semibold text-foreground">{activity.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(activity.actionAt).toLocaleDateString('en-CA')} · {activity.actor}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full Width Section: Attachments & Case Chat */}
      <div className="space-y-4">
        {/* Premium Deliverables Card */}

        <Card className="shadow-card">
          <CardHeader className="py-2.5 px-4 border-b border-border/50">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-primary" />
              Case File
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-2 px-4 pb-3 space-y-2">
            {files.length === 0 ? (
              <p className="text-xs text-muted-foreground">No files attached to this case.</p>
            ) : (
              files.map((file) => (
                <a
                  key={file.id}
                  href={file.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border border-border/50 py-2 px-3 hover:bg-muted/20 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{file.fileName}</p>
                    {file.note && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-pre-wrap">
                        {file.note}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {file.fileType || "Unknown type"} · {formatFileSize(file.fileSize)}
                    </p>
                  </div>
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </a>
              ))
            )}
          </CardContent>
        </Card>

        {(caseRecord.outputFile || caseRecord.previewFile) && (
          <Card className="shadow-card border-indigo-100 bg-[linear-gradient(180deg,rgba(243,244,246,0.5),rgba(249,250,251,0.7))]">
            <CardHeader className="py-2.5 px-4 border-b border-border/50">
              <CardTitle className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-600" />
                Design Deliverables
              </CardTitle>
            </CardHeader>
            <CardContent className="mt-2 px-4 pb-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {caseRecord.outputFile && (
                  <div className="flex flex-col justify-between p-4 rounded-lg border border-indigo-100 bg-white shadow-sm hover:shadow-md transition-shadow">
                    <div>
                      <h4 className="text-sm font-semibold text-indigo-950">Final Design File</h4>
                      {caseRecord.outputNote ? (
                        <p className="text-xs text-indigo-900 mt-1.5 bg-indigo-50/50 rounded p-2 border border-indigo-100/30 whitespace-pre-wrap">
                          {caseRecord.outputNote}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">This is the ready-to-use production CAD/CAM file.</p>
                      )}
                    </div>
                    <div className="mt-4">
                      <a href={caseRecord.outputFile} download target="_blank" rel="noreferrer" className="w-full block">
                        <Button size="sm" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2 font-medium">
                          <Download className="h-4 w-4" /> Download Design
                        </Button>
                      </a>
                    </div>
                  </div>
                )}

                {caseRecord.previewFile && (
                  <div className="flex flex-col justify-between p-4 rounded-lg border border-indigo-100 bg-white shadow-sm hover:shadow-md transition-shadow">
                    <div>
                      <h4 className="text-sm font-semibold text-indigo-950">Interactive 3D Preview</h4>
                      <p className="text-xs text-muted-foreground mt-1">HTML interactive 3D rendering of the case.</p>
                    </div>
                    <div className="mt-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowPreview(!showPreview)}
                        className="w-full border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-medium gap-2"
                      >
                        👁️ {showPreview ? "Hide Preview" : "Show 3D Preview"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {caseRecord.previewFile && showPreview && (
                <div className="mt-4 border border-indigo-100 rounded-lg overflow-hidden bg-zinc-50 shadow-inner">
                  <div className="bg-indigo-950/5 border-b border-indigo-100 px-4 py-2 flex items-center justify-between text-xs text-indigo-900 font-medium">
                    <span>Interactive HTML Viewer</span>
                    <a href={caseRecord.previewFile} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                      Open in New Tab ↗
                    </a>
                  </div>
                  <iframe
                    src={caseRecord.previewFile}
                    className="w-full h-[400px] border-none"
                    title="3D Design Preview"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}



        <div ref={chatRef}>
          <Card className="shadow-card overflow-hidden">
            <CardHeader className="py-2.5 px-4 border-b border-border/50 bg-muted/10">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                Case Chat
                <span className="text-[11px] font-normal text-muted-foreground ml-1">— with Iconic Connect Team</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <CaseChat
                caseId={caseRecord.id}
                side={chatSide}
                className="border-none rounded-none"
                heightClass="h-[500px]"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
