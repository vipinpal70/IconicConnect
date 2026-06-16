"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { ArrowLeft, FileText, MessageSquare, Paperclip, Download } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { StatusBadge } from "@/src/components/StatusBadge"
import { CaseChat } from "@/src/components/CaseChat"
import { CASE_LIFECYCLE_STEPS, CASE_STATUS_TO_LIFECYCLE_STEP } from "@/src/db/schema/case"
import React, { useState, useRef } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import { HOLD_REASONS } from "@/src/lib/case-utils"
import { Eye } from "lucide-react"

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
  preferredTeethLibrary?: string | null
  teethLibraryFileUrl?: string | null
  teethLibraryFileName?: string | null
  clientMassage?: string | null
  holdReason?: string | null
  cancelReason?: string | null
  feedbackReason?: string | null
  rejectReason?: string | null
  autoApproved?: boolean | null
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
  actionTime?: string
}

function renderSubTypeSummary(subTypeData: Record<string, unknown> | null) {
  if (!subTypeData) return "—"

  const values = Object.entries(subTypeData)
    .filter(([key, value]) => key !== "teeth" && key !== "crownBridgeTeeth" && key !== "toothSystem" && key !== "notes" && key !== "modelRequired" && typeof value === "string" && value && value.toLowerCase() !== "none")
    .map(([, value]) => value as string)

  return values.length ? values.join(" - ") : "—"
}

function formatFileSize(size: number | null) {
  if (!size) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

const DetailRow = React.memo(function DetailRow({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/40 py-2 last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground text-right">{value}</span>
    </div>
  )
})

const LifecycleStrip = React.memo(function LifecycleStrip({ status }: { status: string }) {
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
})

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
  const [isHoldDialogOpen, setIsHoldDialogOpen] = useState(false)
  const [holdReasonSelect, setHoldReasonSelect] = useState("")
  const [holdCustomReason, setHoldCustomReason] = useState("")
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false)
  const [changeNotes, setChangeNotes] = useState("")
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false)
  const [rejectNotes, setRejectNotes] = useState("")

  const handleStatusChange = async (targetStatus: string, holdReason?: string) => {
    if (targetStatus === "on_hold" && !holdReason) {
      setIsHoldDialogOpen(true)
      setHoldReasonSelect("")
      setHoldCustomReason("")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
          ...(holdReason ? { holdReason } : {})
        }),
      })
      if (res.ok) {
        toast.success(`Case status updated successfully!`)
        setIsHoldDialogOpen(false)
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

  const handleConfirmHold = () => {
    if (!holdReasonSelect) {
      toast.error("Please select a hold reason.")
      return
    }
    if (holdReasonSelect === "Other (please specify)" && !holdCustomReason.trim()) {
      toast.error("Please specify your reason for holding the case.")
      return
    }
    const finalReason = holdReasonSelect === "Other (please specify)" ? holdCustomReason.trim() : holdReasonSelect
    void handleStatusChange("on_hold", finalReason)
  }

  const handleConfirmChangeRequest = async () => {
    if (!changeNotes.trim()) {
      toast.error("Please describe the changes you are requesting.")
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "change_requested",
          clientMassage: changeNotes.trim()
        }),
      })
      if (res.ok) {
        await fetch(`/api/cases/${caseId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageText: `[CHANGE REQUEST]: ${changeNotes.trim()}` }),
        })
        toast.success("Change request submitted successfully!")
        setIsChangeDialogOpen(false)
        setChangeNotes("")
        router.refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to submit change request")
      }
    } catch {
      toast.error("Failed to submit change request")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRequestChanges = () => {
    setIsChangeDialogOpen(true)
  }

  const handleConfirmReject = async () => {
    if (!rejectNotes.trim()) {
      toast.error("Please describe the reason for rejecting the case.")
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "client_reject",
          clientMassage: rejectNotes.trim()
        }),
      })
      if (res.ok) {
        await fetch(`/api/cases/${caseId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageText: `[CASE REJECTED]: ${rejectNotes.trim()}` }),
        })
        toast.success("Case rejected successfully.")
        setIsRejectDialogOpen(false)
        setRejectNotes("")
        router.refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to reject case")
      }
    } catch {
      toast.error("Failed to reject case")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRejectCase = () => {
    setIsRejectDialogOpen(true)
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
    staleTime: 15_000, // case data fetched by detail view; chat polls separately
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
    staleTime: 30_000, // files don't change frequently
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
  const crownBridgeTeeth = Array.isArray(subTypeData.crownBridgeTeeth) ? (subTypeData.crownBridgeTeeth as number[]) : []
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
        <div className="ml-auto flex items-center gap-2">
          {caseRecord.autoApproved && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
              ⏱ Auto-Approved
            </span>
          )}
          <StatusBadge status={caseRecord.status} role={chatSide === "admin" ? "internal" : "client"} />
        </div>
      </div>

      {caseRecord.clientMassage && (
        <div className={`p-4 rounded-lg border text-xs font-medium flex flex-col gap-1 ${
          caseRecord.status === "client_reject"
            ? "bg-red-50 border-red-200 text-red-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}>
          <span className="font-semibold flex items-center gap-1.5">
            {caseRecord.status === "client_reject" ? "✗ Rejection Reason" : "ℹ Requested Changes"}
          </span>
          <p className="whitespace-pre-wrap font-normal mt-0.5">{caseRecord.clientMassage}</p>
        </div>
      )}

      {caseRecord.holdReason && (
        <div className="p-4 rounded-lg border-2 border-red-500 bg-red-50 text-red-900 text-xs font-medium flex flex-col gap-1 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]">
          <span className="font-bold flex items-center gap-1.5 text-red-600">⏸ On Hold — Reason</span>
          <p className="whitespace-pre-wrap font-normal mt-0.5 text-red-800">{caseRecord.holdReason}</p>
        </div>
      )}

      {caseRecord.cancelReason && (
        <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 text-xs font-medium flex flex-col gap-1">
          <span className="font-semibold flex items-center gap-1.5">🚫 Cancellation Reason</span>
          <p className="whitespace-pre-wrap font-normal mt-0.5">{caseRecord.cancelReason}</p>
        </div>
      )}

      {caseRecord.feedbackReason && (
        <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-medium flex flex-col gap-1">
          <span className="font-semibold flex items-center gap-1.5">💬 QC Feedback</span>
          <p className="whitespace-pre-wrap font-normal mt-0.5">{caseRecord.feedbackReason}</p>
        </div>
      )}

      {caseRecord.rejectReason && (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs font-medium flex flex-col gap-1">
          <span className="font-semibold flex items-center gap-1.5">✗ QC Rejection Reason</span>
          <p className="whitespace-pre-wrap font-normal mt-0.5">{caseRecord.rejectReason}</p>
        </div>
      )}

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
              <DetailRow
                label="Case Files"
                value={
                  files.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {files.map((file) => (
                        <a
                          key={file.id}
                          href={file.fileUrl}
                          download={file.fileName}
                          title={file.fileName}
                          className="text-[10px] font-medium text-primary underline underline-offset-2 cursor-pointer hover:text-primary/70 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {file.fileName.length > 15
                            ? `${file.fileName.slice(0, 15)}…`
                            : file.fileName}
                        </a>
                      ))}
                    </div>
                  )
                }
              />
              <DetailRow label="Model Required" value={modelRequired} />
              {caseRecord.category === "Implant" ? (
                <>
                  <DetailRow label="Implant Teeth" value={teeth.length ? `#${teeth.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})` : "—"} />
                  {crownBridgeTeeth.length > 0 && (
                    <DetailRow label="Crown & Bridge Teeth" value={`#${crownBridgeTeeth.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})`} />
                  )}
                </>
              ) : (
                <DetailRow label="Teeth" value={teeth.length ? `#${teeth.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})` : "—"} />
              )}
              <DetailRow
                label="Preferred Teeth Library"
                value={
                  caseRecord.preferredTeethLibrary === "other" ? (
                    caseRecord.teethLibraryFileUrl ? (
                      <a
                        href={caseRecord.teethLibraryFileUrl}
                        download={caseRecord.teethLibraryFileName || "teeth_library"}
                        className="text-primary hover:text-primary/70 underline underline-offset-2 font-medium"
                      >
                        {caseRecord.teethLibraryFileName || "Other Teeth Library (Download)"}
                      </a>
                    ) : (
                      "Other Teeth Library"
                    )
                  ) : (
                    "Default Teeth Library"
                  )
                }
              />
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
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white w-full"
                      disabled={isSubmitting}
                      onClick={() => handleStatusChange("approved")}
                    >
                      ✓ Approve Case
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs font-medium text-amber-700 border-amber-200 hover:bg-amber-50"
                        onClick={handleRequestChanges}
                      >
                        ✗ Request Changes
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs font-medium text-red-600 border-red-200 hover:bg-red-50"
                        onClick={handleRejectCase}
                      >
                        🚫 Reject Case
                      </Button>
                    </div>
                  </div>
                )}
                {caseRecord.status === "client_reject" && (
                  <p className="text-xs text-red-600 font-semibold text-center py-1 bg-red-50 border border-red-100 rounded-md">
                    ✗ This case has been rejected.
                  </p>
                )}
                {!["scan_received", "scan_not_verified", "scan_verified", "on_hold", "submitted_to_client", "client_reject"].includes(caseRecord.status) && (
                  <p className="text-xs text-muted-foreground italic text-center py-1">No actions available at this stage.</p>
                )}
              </div>
            </CardContent>
          )}
          {chatSide === "admin" && (
            <CardContent className="py-3 px-4 border-t border-border/50 bg-muted/5 rounded-b-lg space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Internal Actions</p>
              <div className="flex flex-col gap-2">
                {caseRecord.status === "change_requested" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={isSubmitting}
                      onClick={() => handleStatusChange("client_feedback")}
                    >
                      ✓ Accept Request
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs font-medium text-red-600 border-red-200 hover:bg-red-50"
                      disabled={isSubmitting}
                      onClick={() => handleStatusChange("submitted_to_client")}
                    >
                      ✗ Decline Request
                    </Button>
                  </div>
                )}
                {caseRecord.status === "client_reject" && (
                  <p className="text-xs text-red-600 font-semibold text-center py-1 bg-red-50 border border-red-100 rounded-md">
                    ✗ This case has been rejected by the client.
                  </p>
                )}
                {caseRecord.status !== "change_requested" && caseRecord.status !== "client_reject" && (
                  <p className="text-xs text-muted-foreground italic text-center py-1">No actions available at this stage.</p>
                )}
              </div>
            </CardContent>
          )}
        </Card>

        {/* Activity Timeline Card */}
        <Card className="shadow-card flex flex-col h-full">
          <CardHeader className="py-2.5 px-4 border-b border-border/50">
            <CardTitle className="text-sm font-semibold">Activity Timeline</CardTitle>
          </CardHeader>
          <CardContent className="mt-2 px-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
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
                        {new Date(activity.actionAt).toLocaleDateString('en-CA')} at {activity.actionTime || new Date(activity.actionAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} · {activity.actor}
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

        {(chatSide === "admin" || ["submitted_to_client", "approved", "delivered"].includes(caseRecord.status)) && (caseRecord.outputFile || caseRecord.previewFile) && (
          <Card className="shadow-card bg-white">
            <CardHeader className="py-2.5 px-4 border-b border-border/50">
              <CardTitle className="text-sm font-semibold text-black flex items-center gap-2">
                {/* <FileText className="h-4 w-4" /> */}
                Design Deliverables
              </CardTitle>
            </CardHeader>
            <CardContent className="mt-2 px-4 pb-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {caseRecord.outputFile && (
                  <div className="flex flex-col justify-between p-4 rounded-lg border border-indigo-100 bg-white shadow-sm hover:shadow-md transition-shadow">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Final Design File</h4>
                      {caseRecord.outputNote ? (
                        <p className="text-xs text-primary mt-1.5 bg-primary/10 rounded p-2 border border-indigo-100/30 whitespace-pre-wrap">
                          {caseRecord.outputNote}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">This is the ready-to-use production CAD/CAM file.</p>
                      )}
                    </div>
                    <div className="mt-4">
                      <a href={caseRecord.outputFile} download target="_blank" rel="noreferrer" className="w-full block">
                        <Button size="sm" className="w-full bg-primary hover:bg-primary/80 text-white gap-2 font-medium">
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
                        className="w-full border-primary/20 text-primary hover:bg-primary/10 font-medium gap-2"
                      >
                          <Eye className="w-4 h-4"/>
                         {showPreview ? "Hide Preview" : "Show Preview"}
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
                heightClass="h-[360px]"
                disabled={caseRecord.status === "client_reject"}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Hold Reason Dropdown Dialog */}
      <Dialog open={isHoldDialogOpen} onOpenChange={(open) => { if (!open) setIsHoldDialogOpen(false); }}>
        <DialogContent className="sm:max-w-[480px] bg-white text-gray-900 border border-gray-200 shadow-xl rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-medium text-gray-900 flex items-center gap-2">
              ⏸ Hold Case
            </DialogTitle>
            <p className="text-xs text-gray-500">
              Please specify the reason before putting this case on hold.
            </p>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="detail-hold-reason-select" className="text-sm font-semibold text-gray-700">
                Hold Reason
              </Label>
              <Select value={holdReasonSelect} onValueChange={setHoldReasonSelect}>
                <SelectTrigger id="detail-hold-reason-select" className="w-full bg-gray-50 border border-gray-300 text-gray-900 focus:ring-emerald-500 rounded-md">
                  <SelectValue placeholder="Select a hold reason..." />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-200 text-gray-900 shadow-lg rounded-md">
                  {HOLD_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason} className="hover:bg-gray-100 focus:bg-gray-100 cursor-pointer">
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {holdReasonSelect === "Other (please specify)" && (
              <div className="space-y-2">
                <Label htmlFor="detail-hold-custom-reason" className="text-sm font-semibold text-gray-700">
                  Specify details
                </Label>
                <Textarea
                  id="detail-hold-custom-reason"
                  value={holdCustomReason}
                  onChange={(e) => setHoldCustomReason(e.target.value)}
                  placeholder="Please specify other hold reason details..."
                  className="min-h-[100px] bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-emerald-500 rounded-md"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setIsHoldDialogOpen(false)}
              className="text-gray-700 border-gray-300 font-normal hover:bg-gray-100"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmHold}
              disabled={isSubmitting || !holdReasonSelect || (holdReasonSelect === "Other (please specify)" && !holdCustomReason.trim())}
              className="text-white bg-emerald-600 hover:bg-emerald-700 font-normal rounded-md"
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Request Changes dialog */}
      <Dialog open={isChangeDialogOpen} onOpenChange={(open) => { if (!open) setIsChangeDialogOpen(false); }}>
        <DialogContent className="sm:max-w-[500px] bg-white text-gray-900 border border-gray-200 shadow-xl rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-medium text-gray-900 flex items-center gap-2">
              ✗ Request Design Changes
            </DialogTitle>
            <p className="text-xs text-gray-500">
              Describe the adjustments you want the designer to make to your design.
            </p>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="detail-change-notes" className="text-sm font-semibold text-gray-700">
                Change Requirements / Notes
              </Label>
              <Textarea
                id="detail-change-notes"
                value={changeNotes}
                onChange={(e) => setChangeNotes(e.target.value)}
                placeholder="Specify what modifications are needed (e.g. adjust margins, change thickness, adapt occlusion)..."
                className="min-h-[140px] bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-emerald-500 rounded-md"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => setIsChangeDialogOpen(false)}
              className="text-gray-700 border-gray-300 font-normal hover:bg-gray-100"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmChangeRequest}
              disabled={isSubmitting || !changeNotes.trim()}
              className="text-white bg-emerald-600 hover:bg-emerald-700 font-normal rounded-md"
            >
              Submit Request
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject Case dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={(open) => { if (!open) setIsRejectDialogOpen(false); }}>
        <DialogContent className="sm:max-w-[500px] bg-white text-gray-900 border border-gray-200 shadow-xl rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-medium text-gray-900 flex items-center gap-2">
              🚫 Reject Case Design
            </DialogTitle>
            <p className="text-xs text-gray-500">
              Please specify the reason for rejecting this case. This will permanently reject the case and halt all work.
            </p>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="detail-reject-notes" className="text-sm font-semibold text-gray-700">
                Rejection Reason / Notes
              </Label>
              <Textarea
                id="detail-reject-notes"
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Describe why you are rejecting this design..."
                className="min-h-[140px] bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-red-500 rounded-md"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => setIsRejectDialogOpen(false)}
              className="text-gray-700 border-gray-300 font-normal hover:bg-gray-100"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmReject}
              disabled={isSubmitting || !rejectNotes.trim()}
              className="text-white bg-red-600 hover:bg-red-700 font-normal rounded-md"
            >
              Confirm Rejection
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
