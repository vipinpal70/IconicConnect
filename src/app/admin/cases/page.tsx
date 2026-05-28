"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Card, CardContent } from "@/src/components/ui/card"
import { Input } from "@/src/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { Button } from "@/src/components/ui/button"
import { StatusBadge } from "@/src/components/StatusBadge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import { CaseChat } from "@/src/components/CaseChat"
import { getPreferences } from "@/src/lib/labStore"
import { HOLD_REASONS } from "@/src/lib/case-utils"
import { CASE_APPROVAL_CHECKLIST as QC_CHECKLIST } from "@/src/lib/case-approval"
import { toast } from "sonner"
import {
  Search,
  ShieldCheck,
  UserPlus,
  ClipboardCheck,
  MessageSquare,
  FileText,
  RefreshCw
} from "lucide-react"

type CaseRecord = {
  id: string
  caseNumber: string | null
  clientId: string
  subuserId: string | null
  category: string | null
  subTypeData: Record<string, unknown> | null
  status: string
  designerId: string | null
  qcId: string | null
  accountManagerId: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
  todayMessagesCount?: number
  hasUnreadChat?: boolean
}

type ChatIndicatorUser = {
  id: string
  role: string
  createdBy?: string | null
} | null | undefined

function shouldShowChatIcon(caseItem: CaseRecord, currentUser: ChatIndicatorUser) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'client' && caseItem.clientId === currentUser.id) return true;
  if (currentUser.role === 'subuser' && (caseItem.subuserId === currentUser.id || caseItem.clientId === currentUser.createdBy)) return true;
  if (caseItem.designerId === currentUser.id || caseItem.qcId === currentUser.id || caseItem.accountManagerId === currentUser.id) return true;
  return false;
}


type ClientRecord = {
  id: string
  fullName: string | null
  labName: string | null
  email: string
  status: string
}

type MemberRecord = {
  id: string
  fullName: string | null
  role: string
  email: string
  status: string
}

type CaseActionType = "approve" | "reject" | "feedback" | "hold"

type CaseActionDialogState = {
  caseId: string
  action: CaseActionType
  caseNumber?: string | null
} | null

const CASE_ACTIONS: Record<
  CaseActionType,
  {
    title: string
    description: string
    status: string
    successMessage: string
    reasonKey?: string
    reasonLabel?: string
    confirmLabel: string
  }
> = {
  approve: {
    title: "Approve Case",
    description: "Complete the QC checklist before approving and sending to the client.",
    status: "submitted_to_client",
    successMessage: "Approved QC and sent design to client",
    confirmLabel: "Confirm",
  },
  reject: {
    title: "Reject Case",
    description: "Add the reason before sending the case back to the designer.",
    status: "in_progress",
    successMessage: "Rejected design; sent back to designer",
    reasonKey: "rejectReason",
    reasonLabel: "Reject reason",
    confirmLabel: "Confirm",
  },
  feedback: {
    title: "Add Feedback",
    description: "Add the feedback reason before sending the case back to the designer.",
    status: "in_progress",
    successMessage: "Feedback logged; sent back to designer",
    reasonKey: "feedbackReason",
    reasonLabel: "Feedback reason",
    confirmLabel: "Send",
  },
  hold: {
    title: "Hold Case",
    description: "Add the hold reason before putting this case on hold.",
    status: "on_hold",
    successMessage: "Case put on hold by QC Lead",
    reasonKey: "holdReason",
    reasonLabel: "Hold reason",
    confirmLabel: "Confirm",
  },
}

const statusFilters = [
  "All",
  "scan_received",
  "allocated_to_designer",
  "scan_verified",
  "scan_not_verified",
  "in_progress",
  "internal_qc",
  "submitted_to_client",
  "on_hold",
  "client_feedback",
  "approved",
  "delivered",
]

const STATUS_LABELS: Record<string, string> = {
  scan_received: "Submitted",
  scan_verified: "Scan Verified",
  scan_not_verified: "Scan Not Verified",
  allocated_to_designer: "Allocated to Designer",
  in_progress: "In Design",
  internal_qc: "Internal QC",
  submitted_to_client: "Pending Client Approval",
  on_hold: "On Hold",
  client_feedback: "Client Feedback",
  approved: "Approved",
  delivered: "Delivered",
}

function renderSubTypeSummary(subTypeData: Record<string, unknown> | null) {
  if (!subTypeData) return "—"

  const values = Object.entries(subTypeData)
    .filter(([key, value]) => key !== "teeth" && key !== "toothSystem" && key !== "notes" && key !== "modelRequired" && typeof value === "string" && value)
    .map(([, value]) => value as string)

  return values.length ? values.join(" - ") : "—"
}

export default function AdminCasesPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [clientFilter, setClientFilter] = useState("All")
  const [openCase, setOpenCase] = useState<CaseRecord | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [assignQcCaseId, setAssignQcCaseId] = useState<string | null>(null)
  const [selectedQcId, setSelectedQcId] = useState<string>("")
  const [pendingCaseAction, setPendingCaseAction] = useState<CaseActionDialogState>(null)
  const [caseActionReason, setCaseActionReason] = useState("")
  const [holdReasonSelect, setHoldReasonSelect] = useState("")
  const [approveChecklist, setApproveChecklist] = useState<Record<string, boolean>>({})

  // Fetch Cases list
  const { data, isLoading, error, refetch } = useQuery<{ data: CaseRecord[] }>({
    queryKey: ["admin-cases"],
    queryFn: async () => {
      const res = await fetch("/api/cases")
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to load cases")
      }
      return res.json()
    },
    refetchInterval: 8000,
  })

  // Fetch Client profiles
  const { data: clientsData } = useQuery<ClientRecord[]>({
    queryKey: ["admin-clients-list"],
    queryFn: async () => {
      const res = await fetch("/api/admin/clients")
      if (!res.ok) return []
      return res.json()
    }
  })

  // Fetch Team members
  const { data: membersData } = useQuery<MemberRecord[]>({
    queryKey: ["admin-members-list"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/admin/members", { cache: "no-store" })
        if (!res.ok) {
          console.error("fetch /api/admin/members failed in admin dashboard, status:", res.status)
          return []
        }
        const data = await res.json()
        console.log("fetch /api/admin/members returned in admin dashboard:", data)
        return data
      } catch (err) {
        console.error("fetch /api/admin/members error in admin dashboard:", err)
        return []
      }
    }
  })

  // Fetch current logged in user
  const { data: currentUser } = useQuery<{ id: string; role: string; fullName: string | null }>({
    queryKey: ["admin-me"],
    queryFn: async () => {
      const res = await fetch("/api/admin/me")
      if (!res.ok) return null
      return res.json()
    }
  })

  // Mappings to translate UUIDs to descriptive names
  const clientsMap = useMemo(() => {
    const map = new Map<string, { labName: string; fullName: string; email: string }>()
    if (clientsData) {
      clientsData.forEach((c) => {
        map.set(c.id, {
          labName: c.labName || "",
          fullName: c.fullName || "",
          email: c.email || ""
        })
      })
    }
    return map
  }, [clientsData])

  const membersMap = useMemo(() => {
    const map = new Map<string, { fullName: string; role: string; email: string }>()
    if (membersData) {
      membersData.forEach((m) => {
        map.set(m.id, {
          fullName: m.fullName || "",
          role: m.role || "",
          email: m.email || ""
        })
      })
    }
    return map
  }, [membersData])

  // Extract active designers for the allocate dropdown
  const designers = useMemo(() => {
    if (!membersData) return []
    return membersData.filter((m) => m.role === "designer" && m.status === "active")
  }, [membersData])

  // Extract active QCs for the allocate dropdown
  const qcs = useMemo(() => {
    if (!membersData) return []
    return membersData.filter((m) => m.role === "qc" && m.status === "active")
  }, [membersData])

  const filtered = useMemo(() => {
    const cases = data?.data || []
    const term = search.toLowerCase()

    return cases.filter((caseItem) => {
      const client = clientsMap.get(caseItem.clientId)
      const clientName = (client?.labName || client?.fullName || "").toLowerCase()
      const restoration = renderSubTypeSummary(caseItem.subTypeData).toLowerCase()

      const matchesSearch =
        !term ||
        (caseItem.caseNumber || caseItem.id).toLowerCase().includes(term) ||
        (caseItem.category || "").toLowerCase().includes(term) ||
        restoration.includes(term) ||
        clientName.includes(term)

      const matchesStatus = statusFilter === "All" || caseItem.status === statusFilter
      const matchesClient = clientFilter === "All" || caseItem.clientId === clientFilter

      return matchesSearch && matchesStatus && matchesClient
    })
  }, [data, search, statusFilter, clientFilter, clientsMap])

  // Live database updates
  const handleUpdate = async (caseId: string, patch: Record<string, string | number | boolean | null>, successMessage: string) => {
    setUpdatingId(caseId)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to update case")
      }
      toast.success(successMessage)
      refetch()
      if (openCase && openCase.id === caseId) {
        // Refresh open case modal data
        const updated = await fetch(`/api/cases/${caseId}`).then(r => r.json()).then(r => r.data)
        if (updated) setOpenCase(updated)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong"
      toast.error(msg)
    } finally {
      setUpdatingId(null)
    }
  }

  const openCaseActionDialog = (caseId: string, action: CaseActionType, caseNumber?: string | null) => {
    setPendingCaseAction({ caseId, action, caseNumber })
    setCaseActionReason("")
    setHoldReasonSelect("")
    setApproveChecklist({})

    if (action === "approve") {
      void (async () => {
        try {
          const res = await fetch(`/api/cases/${caseId}/approval-checklist`)
          if (!res.ok) return
          const payload = await res.json().catch(() => ({}))
          const values = Array.isArray(payload?.data) ? payload.data : []
          const selected = new Set(values)
          setApproveChecklist(
            Object.fromEntries(QC_CHECKLIST.map((item) => [item, selected.has(item)]))
          )
        } catch {
          // Leave checklist empty if it cannot be loaded.
        }
      })()
    }
  }

  const closeCaseActionDialog = () => {
    setPendingCaseAction(null)
    setCaseActionReason("")
    setHoldReasonSelect("")
    setApproveChecklist({})
  }

  const confirmCaseAction = async () => {
    if (!pendingCaseAction) return
    const actionConfig = CASE_ACTIONS[pendingCaseAction.action]
    let reason = caseActionReason.trim()

    if (pendingCaseAction.action === "approve") {
      const allChecked = QC_CHECKLIST.every((item) => approveChecklist[item])
      if (!allChecked) {
        toast.error("Please complete all QC checklist items before approving.")
        return
      }

      setUpdatingId(pendingCaseAction.caseId)
      try {
        const checkedItems = QC_CHECKLIST.filter((item) => approveChecklist[item])
        const res = await fetch(`/api/cases/${pendingCaseAction.caseId}/approval-checklist`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ checkedItems }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || "Failed to approve case")
        }

        toast.success(actionConfig.successMessage)
        refetch()
        if (openCase && openCase.id === pendingCaseAction.caseId) {
          const updated = await fetch(`/api/cases/${pendingCaseAction.caseId}`).then(r => r.json()).then(r => r.data)
          if (updated) setOpenCase(updated)
        }
        closeCaseActionDialog()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Something went wrong"
        toast.error(msg)
      } finally {
        setUpdatingId(null)
      }
      return
    } else if (pendingCaseAction.action === "hold") {
      if (!holdReasonSelect) {
        toast.error("Please select a hold reason.")
        return
      }
      if (holdReasonSelect === "Other (please specify)") {
        if (!reason) {
          toast.error("Please specify your reason for holding the case.")
          return
        }
      } else {
        reason = holdReasonSelect
      }
    } else {
      if (actionConfig.reasonKey && !reason) {
        toast.error(`Please enter a ${actionConfig.reasonLabel?.toLowerCase()}.`)
        return
      }
    }

    const patch = actionConfig.reasonKey
      ? { status: actionConfig.status, [actionConfig.reasonKey]: reason }
      : { status: actionConfig.status }
    await handleUpdate(pendingCaseAction.caseId, patch, actionConfig.successMessage)
    closeCaseActionDialog()
  }

  // Onboarding Preference forms details
  const clientProfile = openCase ? clientsData?.find((c) => c.id === openCase.clientId) : null
  const prefs = openCase ? getPreferences(openCase.clientId) : []

  return (
    <AdminLayout>
      <div className="space-y-4 animate-fade-in text-xs">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold text-foreground">Cases — Review & Allocation</h1>
          <p className="text-xs text-muted-foreground">Triage incoming cases, allocate to designers and route through QC</p>
        </div>

        <Card className="shadow-card border-border/50">
          <CardContent className="p-2.5 flex flex-col lg:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs"
                placeholder="Search by case number, category or subtype..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-full lg:w-48 h-8 text-xs">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent className="bg-primary border-primary/50 text-white">
                <SelectItem className="bg-primary text-white focus:bg-emerald-600 focus:text-white cursor-pointer text-xs" value="All">All clients</SelectItem>
                {clientsData?.map((c) => (
                  <SelectItem className="bg-primary text-white focus:bg-emerald-600 focus:text-white cursor-pointer text-xs" key={c.id} value={c.id}>
                    {c.labName || c.fullName || c.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full lg:w-48 h-8 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent className="bg-primary border-primary/50 text-white">
                {statusFilters.map((status) => (
                  <SelectItem key={status} value={status} className="bg-primary text-white focus:bg-emerald-600 focus:text-white cursor-pointer text-xs">
                    {status === "All" ? "All Statuses" : (STATUS_LABELS[status] || status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Case", "Client", "Type/Teeth", "Status", "Designer", "Created At", "Actions"].map((heading) => (
                      <th key={heading} className="text-left px-3.5 py-2 text-xs font-semibold text-muted-foreground">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-3.5 py-2"><div className="h-3.5 bg-muted rounded w-16" /></td>
                        <td className="px-3.5 py-2"><div className="h-3.5 bg-muted rounded w-20" /></td>
                        <td className="px-3.5 py-2"><div className="h-3.5 bg-muted rounded w-28" /></td>
                        <td className="px-3.5 py-2"><div className="h-5.5 bg-muted rounded-full w-20" /></td>
                        <td className="px-3.5 py-2"><div className="h-3.5 bg-muted rounded w-20" /></td>
                        <td className="px-3.5 py-2"><div className="h-3.5 bg-muted rounded w-12" /></td>
                        <td className="px-3.5 py-2"><div className="h-7 bg-muted rounded w-24" /></td>
                      </tr>
                    ))
                  ) : error ? (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-8 text-center text-xs text-red-500">
                        {(error as Error).message}
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-8 text-center text-xs text-muted-foreground">
                        No cases found.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((caseItem) => {
                      const client = clientsMap.get(caseItem.clientId)
                      const clientDisplayName = client?.labName || client?.fullName || "—"
                      const restoration = renderSubTypeSummary(caseItem.subTypeData)
                      const teeth = (caseItem.subTypeData?.teeth as number[]) || []
                      const toothSystem = (caseItem.subTypeData?.toothSystem as string) || "USA"
                      const designerName = membersMap.get(caseItem.designerId || "")?.fullName || "—"
                      const isMutating = updatingId === caseItem.id
                      const hasUnreadChat = Boolean(caseItem.hasUnreadChat);

                      return (
                        <tr
                          key={caseItem.id}
                          className={`hover:bg-muted/10 transition-colors border-l-2 ${caseItem.status === "submitted_to_client" ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.08] border-l-amber-500 font-medium" : "border-l-transparent"}`}
                        >
                          <td className="px-3.5 py-2">
                            <div className="flex items-center gap-1.5">
                              <Link href={`/admin/cases/${caseItem.id}`} className="hover:underline cursor-pointer font-semibold text-xs text-black">
                                {caseItem.caseNumber || caseItem.id}
                              </Link>
                            </div>
                          </td>
                          <td className="px-3.5 py-2 text-[11px] text-foreground">{clientDisplayName}</td>
                          <td className="px-3.5 py-2">
                            <p className="font-semibold text-[11px] text-black">{restoration || "—"}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {caseItem.category} · {teeth.length ? `#${teeth.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})` : "—"}
                            </p>
                          </td>
                          <td className="px-3.5 py-2">
                            <div className="scale-90 origin-left">
                              <StatusBadge status={caseItem.status} role="internal" />
                            </div>
                          </td>
                          <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{designerName}</td>
                          <td className="px-3.5 py-2 text-[10px] text-muted-foreground whitespace-nowrap">
                            {new Date(caseItem.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-3.5 py-2">
                            <div className="flex gap-1.5 items-center flex-wrap">
                              {/* 1. Admin and QC Lead actions */}
                              {(currentUser?.role === "admin" || currentUser?.role === "qc") && (
                                <>
                                  {caseItem.status === "scan_received" && (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={isMutating}
                                        onClick={() => handleUpdate(caseItem.id, { status: "scan_verified" }, `Scan validated · ready for allocation`)}
                                        title="Validate scan"
                                        className="h-7 text-[10px] px-2.5"
                                      >
                                        <ShieldCheck className="h-3 w-3 mr-0.5" />Validate
                                      </Button>
                                      <AllocateMenu
                                        designers={designers}
                                        disabled={isMutating}
                                        onPick={(dId) => handleUpdate(caseItem.id, { designerId: dId, status: "allocated_to_designer" }, `Allocated case to designer`)}
                                      />
                                    </>
                                  )}

                                  {(caseItem.status === "scan_verified" || caseItem.status === "scan_not_verified") && (
                                    <AllocateMenu
                                      designers={designers}
                                      disabled={isMutating}
                                      onPick={(dId) => handleUpdate(caseItem.id, { designerId: dId, status: "allocated_to_designer" }, `Allocated case to designer`)}
                                    />
                                  )}

                                  {(caseItem.status === "allocated_to_designer" || caseItem.status === "in_progress") && (
                                    <>
                                      {!caseItem.designerId ? (
                                        <AllocateMenu
                                          designers={designers}
                                          disabled={isMutating}
                                          onPick={(dId) => handleUpdate(caseItem.id, { designerId: dId, status: "allocated_to_designer" }, `Allocated case to designer`)}
                                        />
                                      ) : (
                                        <>
                                          {!caseItem.qcId ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              disabled={isMutating}
                                              onClick={() => setAssignQcCaseId(caseItem.id)}
                                              className="h-7 text-[10px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm font-bold"
                                            >
                                              <UserPlus className="h-3 w-3 mr-0.5" /> Assign QC
                                            </Button>
                                          ) : (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              disabled={isMutating}
                                              onClick={() => handleUpdate(caseItem.id, { status: "internal_qc" }, `Submitted case to Internal QC`)}
                                              className="h-7 text-[10px] px-2.5 bg-primary border-primary/50 text-white font-bold hover:bg-zinc-800"
                                            >
                                              <ClipboardCheck className="h-3 w-3 mr-0.5" /> Send to QC
                                            </Button>
                                          )}
                                        </>
                                      )}
                                    </>
                                  )}

                                  {caseItem.status === "internal_qc" && (
                                    <div className="flex flex-wrap gap-1 items-center">
                                      <Button
                                        size="sm"
                                        disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(caseItem.id, "approve", caseItem.caseNumber); }}
                                        className="h-7 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm transition-all"
                                      >
                                        ✓ Approve
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(caseItem.id, "reject", caseItem.caseNumber); }}
                                        className="h-7 text-[10px] px-2 font-bold bg-red-600 hover:bg-red-700 shadow-sm transition-all"
                                      >
                                        ✗ Reject
                                      </Button>
                                      <Button
                                        size="sm"
                                        disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(caseItem.id, "feedback", caseItem.caseNumber); }}
                                        className="h-7 text-[10px] px-2 font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all"
                                      >
                                        💬 Feedback
                                      </Button>
                                      <Button
                                        size="sm"
                                        disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(caseItem.id, "hold", caseItem.caseNumber); }}
                                        className="h-7 text-[10px] px-2 font-bold bg-gray-500 hover:bg-gray-600 text-white shadow-sm transition-all"
                                      >
                                        ⏸ Hold
                                      </Button>
                                    </div>
                                  )}

                                  {caseItem.status === "client_feedback" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={isMutating}
                                      onClick={() => handleUpdate(caseItem.id, { status: "in_progress" }, `Sent case back to design`)}
                                      className="h-7 text-[10px] px-2"
                                    >
                                      Back to designer
                                    </Button>
                                  )}
                                  {caseItem.status === "on_hold" && (
                                    <Button
                                      size="sm"
                                      disabled={isMutating}
                                      onClick={() => handleUpdate(caseItem.id, { status: "scan_received" }, `Case resumed to active queue`)}
                                      className="h-7 text-[10px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm transition-all"
                                    >
                                      <RefreshCw className="h-3 w-3 mr-0.5" /> Resume Case
                                    </Button>
                                  )}
                                </>
                              )}

                              {/* 2. Designer actions */}
                              {currentUser?.role === "designer" && (
                                <>
                                  {/* Allocate to Self for unallocated cases */}
                                  {!caseItem.designerId && (caseItem.status === "scan_received" || caseItem.status === "scan_verified") && (
                                    <Button
                                      size="sm"
                                      disabled={isMutating}
                                      onClick={() => handleUpdate(caseItem.id, { designerId: currentUser.id, status: "allocated_to_designer" }, `Allocated case to yourself`)}
                                      className="h-7 text-[10px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm transition-all"
                                    >
                                      <UserPlus className="h-3 w-3 mr-0.5" /> Allocate to Self
                                    </Button>
                                  )}

                                  {/* Actions on assigned cases */}
                                  {caseItem.designerId === currentUser?.id && (
                                    <>
                                      {caseItem.status === "allocated_to_designer" && (
                                        <div className="flex gap-1.5">
                                          <Button
                                            size="sm"
                                            disabled={isMutating}
                                            onClick={() => handleUpdate(caseItem.id, { status: "in_progress" }, `Started design work`)}
                                            className="h-7 text-[10px] px-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-sm"
                                          >
                                            Start Work
                                          </Button>
                                          {!caseItem.qcId && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              disabled={isMutating}
                                              onClick={() => setAssignQcCaseId(caseItem.id)}
                                              className="h-7 text-[10px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm font-bold"
                                            >
                                              <UserPlus className="h-3 w-3 mr-0.5" /> Assign QC
                                            </Button>
                                          )}
                                        </div>
                                      )}

                                      {caseItem.status === "in_progress" && (
                                        <>
                                          {!caseItem.qcId ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              disabled={isMutating}
                                              onClick={() => setAssignQcCaseId(caseItem.id)}
                                              className="h-7 text-[10px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm font-bold"
                                            >
                                              <UserPlus className="h-3 w-3 mr-0.5" /> Assign QC
                                            </Button>
                                          ) : (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              disabled={isMutating}
                                              onClick={() => handleUpdate(caseItem.id, { status: "internal_qc" }, `Submitted case to Internal QC`)}
                                              className="h-7 text-[10px] px-2.5 bg-primary border-primary/50 text-white font-bold hover:bg-zinc-800"
                                            >
                                              <ClipboardCheck className="h-3 w-3 mr-0.5" /> Send to QC
                                            </Button>
                                          )}
                                        </>
                                      )}

                                      {/* Status display indicators */}
                                      {caseItem.status === "internal_qc" && (
                                        <span className="text-[10px] text-amber-600 italic px-1">In QC Review</span>
                                      )}

                                      {caseItem.status === "client_feedback" && (
                                        <Button
                                          size="sm"
                                          disabled={isMutating}
                                          onClick={() => handleUpdate(caseItem.id, { status: "in_progress" }, `Restarted design to apply feedback`)}
                                          className="h-7 text-[10px] px-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-sm"
                                        >
                                          Apply Feedback
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </>
                              )}

                              {/* 3. Awaiting client status display (visible to admin/qc, and designer if assigned) */}
                              {caseItem.status === "submitted_to_client" &&
                                ((currentUser?.role === "admin" || currentUser?.role === "qc") || caseItem.designerId === currentUser?.id) && (
                                  <span className="text-[10px] text-muted-foreground italic px-1">awaiting client…</span>
                                )}

                              {/* 4. Completed status display (visible to admin/qc, and designer if assigned) */}
                              {(caseItem.status === "approved" || caseItem.status === "delivered") &&
                                ((currentUser?.role === "admin" || currentUser?.role === "qc") || caseItem.designerId === currentUser?.id) && (
                                  <span className="text-[10px] text-green-600 font-bold px-1">Completed</span>
                                )}


                              {shouldShowChatIcon(caseItem, currentUser) && (hasUnreadChat || (caseItem.todayMessagesCount || 0) > 0) && (
                                <span className="relative inline-flex items-center shrink-0" title={hasUnreadChat ? "New Messages" : `${caseItem.todayMessagesCount} messages today`}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setOpenCase(caseItem)}
                                    title="Open case · chat & preferences"
                                    className="h-4 w-4 p-0"
                                  >
                                    <MessageSquare className={`h-4 w-4 shrink-0 ${hasUnreadChat ? "text-emerald-500" : "text-slate-400"}`} />


                                  </Button>
                                  {hasUnreadChat ? (
                                    <span className="absolute -top-0.6 -right-0.6 flex h-1.5 w-1.5">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                    </span>
                                  ) : (
                                    <span className="absolute -top-1.5 -right-1.5 min-w-3 h-3 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-bold border border-white leading-none">
                                      {caseItem.todayMessagesCount}
                                    </span>
                                  )}
                                </span>
                              )}


                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!openCase} onOpenChange={(o) => !o && setOpenCase(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto text-xs">
          {openCase && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                  {openCase.caseNumber || openCase.id} · {renderSubTypeSummary(openCase.subTypeData)}
                  <div className="scale-90 origin-left">
                    <StatusBadge status={openCase.status} role="internal" />
                  </div>
                </DialogTitle>
                <p className="text-[11px] text-muted-foreground">
                  {clientsMap.get(openCase.clientId)?.labName || "—"} · {openCase.category} · Due {openCase.dueDate ? new Date(openCase.dueDate).toLocaleDateString() : "—"}
                </p>
              </DialogHeader>

              <Tabs defaultValue="chat" className="mt-2 text-xs">
                <TabsList className="grid w-full grid-cols-3 h-8">
                  <TabsTrigger value="chat" className="text-xs h-7">
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />Chat
                  </TabsTrigger>
                  <TabsTrigger value="prefs" className="text-xs h-7">
                    <FileText className="h-3.5 w-3.5 mr-1" />Lab preferences
                  </TabsTrigger>
                  <TabsTrigger value="details" className="text-xs h-7">Details</TabsTrigger>
                </TabsList>

                <TabsContent value="chat" className="mt-3">
                  <CaseChat caseId={openCase.id} side="admin" heightClass="h-[400px]" />
                </TabsContent>

                <TabsContent value="prefs" className="mt-3 space-y-2 text-xs">
                  {!clientProfile && <p className="text-xs text-muted-foreground">Lab profile not found.</p>}
                  {clientProfile && prefs.length === 0 && (
                    <p className="text-xs text-muted-foreground">{clientProfile.labName || clientProfile.fullName} has not added any preference forms yet.</p>
                  )}
                  {prefs.map((p) => (
                    <Card key={p.id} className="shadow-card">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-0.5">
                          <p className="font-semibold text-foreground">{p.title}</p>
                          <span className="text-[10px] text-muted-foreground">{p.category}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mb-1.5">added {p.createdAt}</p>
                        <p className="text-xs text-foreground whitespace-pre-wrap">{p.body}</p>
                      </CardContent>
                    </Card>
                  ))}
                  {clientProfile && (
                    <div className="p-3 bg-muted/20 border rounded-lg space-y-1">
                      <p className="text-xs font-bold text-foreground">Lab Details</p>
                      <p className="text-xs text-muted-foreground">Lab Name: <span className="text-foreground font-medium">{clientProfile.labName || "—"}</span></p>
                      <p className="text-xs text-muted-foreground">Contact: <span className="text-foreground font-medium">{clientProfile.fullName || "—"} ({clientProfile.email})</span></p>
                      <p className="text-xs text-muted-foreground">Status: <span className="text-foreground font-medium">{clientProfile.status || "—"}</span></p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="details" className="mt-3 space-y-1.5 text-xs">
                  <Row k="Designer" v={membersMap.get(openCase.designerId || "")?.fullName || "Not allocated"} />
                  <Row k="QC Lead" v={membersMap.get(openCase.qcId || "")?.fullName || "—"} />
                  <Row k="Model required" v={openCase.subTypeData?.modelRequired ? "Yes" : "No"} />
                  <Row k="Teeth" v={((openCase.subTypeData?.teeth as number[]) || []).length ? `#${((openCase.subTypeData?.teeth as number[]) || []).join(", #")} (${(openCase.subTypeData?.toothSystem as string) || "USA"})` : "—"} />
                  <Row k="Submitted" v={new Date(openCase.createdAt).toLocaleString()} />
                  <Row k="Last update" v={new Date(openCase.updatedAt).toLocaleString()} />
                  <div className="pt-1.5 border-t border-border mt-2">
                    <p className="text-muted-foreground mb-0.5">Notes</p>
                    <p className="text-foreground whitespace-pre-wrap">{openCase.subTypeData?.notes as string || "—"}</p>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingCaseAction} onOpenChange={(open) => { if (!open) closeCaseActionDialog(); }}>
        <DialogContent className="sm:max-w-[560px] bg-white text-gray-900 shadow-xl text-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-gray-900 flex items-center gap-2">
              {pendingCaseAction ? CASE_ACTIONS[pendingCaseAction.action].title : "Case Action"}
            </DialogTitle>
            <p className="text-xs text-gray-700 mt-0.5">
              {pendingCaseAction ? CASE_ACTIONS[pendingCaseAction.action].description : ""}
              {pendingCaseAction?.caseNumber ? ` Case ${pendingCaseAction.caseNumber}.` : ""}
            </p>
          </DialogHeader>
          {pendingCaseAction?.action === "approve" && (
            <div className="grid gap-2.5 py-3 border-t border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600">
                Quality Checklist
              </p>
              <div className="grid gap-2">
                {QC_CHECKLIST.map((item) => {
                  const itemId = `admin-approve-check-${item.replace(/\s+/g, "-").toLowerCase()}`
                  return (
                    <label
                      key={item}
                      htmlFor={itemId}
                      className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-800"
                    >
                      <input
                        id={itemId}
                        type="checkbox"
                        checked={!!approveChecklist[item]}
                        onChange={(e) =>
                          setApproveChecklist((current) => ({
                            ...current,
                            [item]: e.target.checked,
                          }))
                        }
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <span className="text-xs font-medium leading-5">{item}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          {pendingCaseAction && CASE_ACTIONS[pendingCaseAction.action].reasonKey && (
            <div className="grid gap-2.5 py-3">
              <Label htmlFor="admin-case-action-reason" className="text-xs font-bold text-gray-700">
                {CASE_ACTIONS[pendingCaseAction.action].reasonLabel}
              </Label>              {pendingCaseAction.action === "hold" ? (
                <div className="space-y-2">
                  <Select value={holdReasonSelect} onValueChange={setHoldReasonSelect}>
                    <SelectTrigger className="w-full h-8 text-xs bg-gray-50 border text-gray-900 focus:ring-primary/80">
                      <SelectValue placeholder="Select a hold reason..." />
                    </SelectTrigger>
                    <SelectContent className="bg-white border text-gray-900 shadow-lg">
                      {HOLD_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason} className="hover:bg-gray-100 focus:bg-gray-100 text-xs">
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {holdReasonSelect === "Other (please specify)" && (
                    <Textarea
                      id="admin-case-action-reason"
                      value={caseActionReason}
                      onChange={(e) => setCaseActionReason(e.target.value)}
                      placeholder="Please specify other hold reason details..."
                      className="min-h-[80px] text-xs bg-gray-100 border text-gray-900 placeholder:text-gray-400 focus-visible:ring-primary/80"
                    />
                  )}
                </div>
              ) : (
                <Textarea
                  id="admin-case-action-reason"
                  value={caseActionReason}
                  onChange={(e) => setCaseActionReason(e.target.value)}
                  placeholder={`Add ${CASE_ACTIONS[pendingCaseAction.action].reasonLabel?.toLowerCase()}`}
                  className="min-h-[100px] text-xs bg-gray-100 border text-gray-900 placeholder:text-gray-400 focus-visible:ring-primary/80"
                />
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <Button
              variant="ghost"
              onClick={closeCaseActionDialog}
              className="text-gray-900 bg-gray-300 font-normal h-8 text-xs px-3"
              disabled={updatingId === pendingCaseAction?.caseId}
            >
              Cancel
            </Button>
            <Button
              disabled={
                updatingId === pendingCaseAction?.caseId ||
                (pendingCaseAction
                  ? pendingCaseAction.action === "hold"
                    ? !holdReasonSelect || (holdReasonSelect === "Other (please specify)" && !caseActionReason.trim())
                    : pendingCaseAction.action === "approve"
                      ? !QC_CHECKLIST.every((item) => approveChecklist[item])
                      : Boolean(CASE_ACTIONS[pendingCaseAction.action].reasonKey && !caseActionReason.trim())
                  : true)
              }
              onClick={confirmCaseAction}
              className={"text-white bg-primary font-normal h-8 text-xs px-3"}
            >
              {pendingCaseAction ? CASE_ACTIONS[pendingCaseAction.action].confirmLabel : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignQcCaseId} onOpenChange={(o) => { if (!o) { setAssignQcCaseId(null); setSelectedQcId(""); } }}>
        <DialogContent className="sm:max-w-[425px] bg-primary border-primary/50 text-white shadow-xl text-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-white flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500" /> Assign QC Lead
            </DialogTitle>
            <p className="text-[11px] text-zinc-300 mt-0.5">
              Select an active Quality Control team member to allocate to this case and transition it to QC review.
            </p>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <div className="grid gap-1">
              <label htmlFor="qc-select" className="text-xs font-bold text-zinc-200">
                QC Member
              </label>
              <Select value={selectedQcId} onValueChange={setSelectedQcId}>
                <SelectTrigger id="qc-select" className="bg-primary/80 border-primary-50/50 text-white focus:bg-emerald-600 focus:text-white h-8 text-xs">
                  <SelectValue placeholder="Select QC Lead" />
                </SelectTrigger>
                <SelectContent className="bg-primary border-primary-50/50 text-white">
                  {qcs.map((qc) => (
                    <SelectItem
                      key={qc.id}
                      value={qc.id}
                      className="text-white focus:bg-emerald-600 focus:text-white cursor-pointer text-xs"
                    >
                      {qc.fullName}
                    </SelectItem>
                  ))}
                  {qcs.length === 0 && (
                    <p className="text-xs p-2 text-zinc-400">No active QC leads found.</p>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button
              variant="ghost"
              onClick={() => { setAssignQcCaseId(null); setSelectedQcId(""); }}
              className="text-white hover:bg-zinc-800 h-8 text-xs px-3"
            >
              Cancel
            </Button>
            <Button
              disabled={!selectedQcId || updatingId === assignQcCaseId}
              onClick={async () => {
                if (!assignQcCaseId || !selectedQcId) return
                await handleUpdate(
                  assignQcCaseId,
                  { qcId: selectedQcId, status: "internal_qc" },
                  "Successfully assigned QC lead and transitioned case status to Internal QC"
                )
                setAssignQcCaseId(null)
                setSelectedQcId("")
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-8 text-xs px-3"
            >
              Assign & Transition
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-border/40 last:border-0 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground font-medium text-right">{v}</span>
    </div>
  )
}

function AllocateMenu({
  designers,
  onPick,
  disabled
}: {
  designers: MemberRecord[]
  onPick: (designerId: string) => void
  disabled?: boolean
}) {
  return (
    <Select onValueChange={onPick} disabled={disabled}>
      <SelectTrigger className="h-7 text-[10px] w-[120px] border-border/80 px-2">
        <span className="flex items-center">
          <UserPlus className="h-3 w-3 mr-1" /> Allocate
        </span>
      </SelectTrigger>
      <SelectContent className="bg-primary border-primary/50 text-white">
        {designers.map((d) => (
          <SelectItem key={d.id} value={d.id} className="bg-primary text-white focus:bg-emerald-600 focus:text-white cursor-pointer text-xs">
            {d.fullName || d.email}
          </SelectItem>
        ))}
        {designers.length === 0 && (
          <SelectItem value="none" disabled className="bg-primary text-white/50 focus:bg-[#047857] cursor-not-allowed text-xs">
            No active designers
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}
