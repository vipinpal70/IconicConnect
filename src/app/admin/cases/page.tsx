"use client"

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
import { CaseChat } from "@/src/components/CaseChat"
import { getPreferences } from "@/src/lib/labStore"
import { toast } from "sonner"
import {
  Search,
  ShieldCheck,
  UserPlus,
  ClipboardCheck,
  ArrowRight,
  MessageSquare,
  FileText
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
      const res = await fetch("/api/admin/members")
      if (!res.ok) return []
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

  // Onboarding Preference forms details
  const clientProfile = openCase ? clientsData?.find((c) => c.id === openCase.clientId) : null
  const prefs = openCase ? getPreferences(openCase.clientId) : []

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Cases — Review & Allocation</h1>
          <p className="text-sm text-muted-foreground mt-1">Triage incoming cases, allocate to designers and route through QC</p>
        </div>

        <Card className="shadow-card border-border/50">
          <CardContent className="p-4 flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by case number, category or subtype..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-full lg:w-60">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All clients</SelectItem>
                {clientsData?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.labName || c.fullName || c.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full lg:w-60">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {statusFilters.map((status) => (
                  <SelectItem key={status} value={status}>
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Case", "Client", "Type / Restoration", "Status", "Designer", "Due", "Actions"].map((heading) => (
                      <th key={heading} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-20" /></td>
                        <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-24" /></td>
                        <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-36" /></td>
                        <td className="px-4 py-3"><div className="h-6 bg-muted rounded-full w-24" /></td>
                        <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-24" /></td>
                        <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-16" /></td>
                        <td className="px-4 py-3"><div className="h-8 bg-muted rounded w-28" /></td>
                      </tr>
                    ))
                  ) : error ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-sm text-red-500">
                        {(error as Error).message}
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
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

                      return (
                        <tr
                          key={caseItem.id}
                          className="hover:bg-muted/10 transition-colors"
                        >
                          <td className="px-4 py-3 font-semibold text-primary">{caseItem.caseNumber || caseItem.id}</td>
                          <td className="px-4 py-3 text-foreground">{clientDisplayName}</td>
                          <td className="px-4 py-3">
                            <p className="text-foreground">{restoration || "—"}</p>
                            <p className="text-xs text-muted-foreground">
                              {caseItem.category} · {teeth.length ? `#${teeth.join(", #")} (${toothSystem})` : "—"}
                            </p>
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={caseItem.status} /></td>
                          <td className="px-4 py-3 text-muted-foreground">{designerName}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                            {caseItem.dueDate ? new Date(caseItem.dueDate).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2 items-center flex-wrap">
                              {caseItem.status === "scan_received" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isMutating}
                                    onClick={() => handleUpdate(caseItem.id, { status: "scan_verified" }, `Scan validated · ready for allocation`)}
                                    title="Validate scan"
                                    className="h-8 text-xs"
                                  >
                                    <ShieldCheck className="h-3.5 w-3.5 mr-1" />Validate
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
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={isMutating}
                                      onClick={() => handleUpdate(caseItem.id, { status: "internal_qc" }, `Submitted case to Internal QC`)}
                                      className="h-8 text-xs"
                                    >
                                      <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Send to QC
                                    </Button>
                                  )}
                                </>
                              )}

                              {caseItem.status === "internal_qc" && (
                                <Button
                                  size="sm"
                                  disabled={isMutating}
                                  onClick={() => handleUpdate(caseItem.id, { status: "submitted_to_client" }, `Sent case to client for approval`)}
                                  className="h-8 text-xs bg-primary hover:bg-primary/90"
                                >
                                  Approve & Send to Client <ArrowRight className="h-3.5 w-3.5 ml-1" />
                                </Button>
                              )}

                              {caseItem.status === "client_feedback" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isMutating}
                                  onClick={() => handleUpdate(caseItem.id, { status: "in_progress" }, `Sent case back to design`)}
                                  className="h-8 text-xs"
                                >
                                  Back to designer
                                </Button>
                              )}

                              {caseItem.status === "submitted_to_client" && (
                                <span className="text-xs text-muted-foreground italic px-1">awaiting client…</span>
                              )}

                              {(caseItem.status === "approved" || caseItem.status === "delivered") && (
                                <span className="text-xs text-green-600 font-semibold px-1">Completed</span>
                              )}

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setOpenCase(caseItem)}
                                title="Open case · chat & preferences"
                                className="h-8 w-8 p-0"
                              >
                                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                              </Button>
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
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          {openCase && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                  {openCase.caseNumber || openCase.id} · {renderSubTypeSummary(openCase.subTypeData)}
                  <StatusBadge status={openCase.status} />
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {clientsMap.get(openCase.clientId)?.labName || "—"} · {openCase.category} · Patient Ref {openCase.subTypeData?.patientRef as string || "—"} · Due {openCase.dueDate ? new Date(openCase.dueDate).toLocaleDateString() : "—"}
                </p>
              </DialogHeader>

              <Tabs defaultValue="chat" className="mt-2">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="chat">
                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" />Chat
                  </TabsTrigger>
                  <TabsTrigger value="prefs">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />Lab preferences
                  </TabsTrigger>
                  <TabsTrigger value="details">Details</TabsTrigger>
                </TabsList>

                <TabsContent value="chat" className="mt-4">
                  <CaseChat caseId={openCase.id} side="admin" author="Iconic Connect Team" heightClass="h-[440px]" />
                </TabsContent>

                <TabsContent value="prefs" className="mt-4 space-y-3">
                  {!clientProfile && <p className="text-sm text-muted-foreground">Lab profile not found.</p>}
                  {clientProfile && prefs.length === 0 && (
                    <p className="text-sm text-muted-foreground">{clientProfile.labName || clientProfile.fullName} has not added any preference forms yet.</p>
                  )}
                  {prefs.map((p) => (
                    <Card key={p.id} className="shadow-card">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-1">
                          <p className="font-medium text-foreground">{p.title}</p>
                          <span className="text-xs text-muted-foreground">{p.category}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">added {p.createdAt}</p>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{p.body}</p>
                      </CardContent>
                    </Card>
                  ))}
                  {clientProfile && (
                    <div className="p-3 bg-muted/20 border rounded-lg space-y-1">
                      <p className="text-xs font-semibold text-foreground">Lab Details</p>
                      <p className="text-xs text-muted-foreground">Lab Name: <span className="text-foreground font-medium">{clientProfile.labName || "—"}</span></p>
                      <p className="text-xs text-muted-foreground">Contact: <span className="text-foreground font-medium">{clientProfile.fullName || "—"} ({clientProfile.email})</span></p>
                      <p className="text-xs text-muted-foreground">Status: <span className="text-foreground font-medium">{clientProfile.status || "—"}</span></p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="details" className="mt-4 space-y-2 text-sm">
                  <Row k="Designer" v={membersMap.get(openCase.designerId || "")?.fullName || "Not allocated"} />
                  <Row k="QC Lead" v={membersMap.get(openCase.qcId || "")?.fullName || "—"} />
                  <Row k="Model required" v={openCase.subTypeData?.modelRequired ? "Yes" : "No"} />
                  <Row k="Teeth" v={((openCase.subTypeData?.teeth as number[]) || []).length ? `#${((openCase.subTypeData?.teeth as number[]) || []).join(", #")} (${(openCase.subTypeData?.toothSystem as string) || "USA"})` : "—"} />
                  <Row k="Submitted" v={new Date(openCase.createdAt).toLocaleString()} />
                  <Row k="Last update" v={new Date(openCase.updatedAt).toLocaleString()} />
                  <div className="pt-2 border-t border-border">
                    <p className="text-muted-foreground mb-1">Notes</p>
                    <p className="text-foreground whitespace-pre-wrap">{openCase.subTypeData?.notes as string || "—"}</p>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-border/40 last:border-0">
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
      <SelectTrigger className="h-8 text-xs w-[160px] border-border/80">
        <span className="flex items-center">
          <UserPlus className="h-3.5 w-3.5 mr-1" /> Allocate
        </span>
      </SelectTrigger>
      <SelectContent>
        {designers.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.fullName || d.email}
          </SelectItem>
        ))}
        {designers.length === 0 && (
          <SelectItem value="none" disabled>
            No active designers
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}
