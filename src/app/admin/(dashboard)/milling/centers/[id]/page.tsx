/* eslint-disable react-hooks/set-state-in-effect */
"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Switch } from "@/src/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs"
import { MillingServiceCatalogTable } from "@/src/components/MillingServiceCatalogTable"
import { ManageUsersDialog } from "../../_components/ManageUsersDialog"
import { uploadMillingCenterContract } from "@/src/lib/upload-utils"
import { toast } from "sonner"
import {
  ArrowLeft, Building2, Save, MapPin, CalendarDays, ShieldCheck,
  FileText, Upload, Download, Users, Wrench,
} from "lucide-react"
import type { MillingCenter } from "@/src/db/schema/milling"
import type { ServiceType } from "@/src/lib/case-status-mapping"

const FLOWS: ServiceType[] = ["design_only", "design_milling", "milling_only"]
const FLOW_LABELS: Record<ServiceType, string> = {
  design_only: "Design",
  design_milling: "Design + Milling",
  milling_only: "Milling Only",
}

function toCsv(values?: string[] | null) {
  return values?.join(", ") ?? ""
}
function fromCsv(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean)
}

type CompanyForm = {
  name: string; legalName: string; contactName: string; email: string; phone: string
  ownerName: string; ownerEmail: string; ownerPhone: string
  financePocName: string; financePocEmail: string; financePocPhone: string
  city: string; state: string; country: string
}
type CoverageForm = { statesServed: string; avgTatDays: string }

function companyFormFromCenter(c: MillingCenter): CompanyForm {
  return {
    name: c.name, legalName: c.legalName || "", contactName: c.contactName || "", email: c.email || "", phone: c.phone || "",
    ownerName: c.ownerName || "", ownerEmail: c.ownerEmail || "", ownerPhone: c.ownerPhone || "",
    financePocName: c.financePocName || "", financePocEmail: c.financePocEmail || "", financePocPhone: c.financePocPhone || "",
    city: c.city || "", state: c.state || "", country: c.country || "",
  }
}
function coverageFormFromCenter(c: MillingCenter): CoverageForm {
  return { statesServed: toCsv(c.statesServed), avgTatDays: c.avgTatDays != null ? String(c.avgTatDays) : "" }
}

export default function MillingCenterDetailPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useParams<{ id: string }>()
  const centerId = Array.isArray(params?.id) ? params.id[0] : params?.id

  const [companyForm, setCompanyForm] = useState<CompanyForm | null>(null)
  const [coverageForm, setCoverageForm] = useState<CoverageForm | null>(null)
  const [catalogTab, setCatalogTab] = useState<ServiceType>("design_only")
  const [managingUsers, setManagingUsers] = useState(false)
  const [contractUploading, setContractUploading] = useState(false)
  const [contractProgress, setContractProgress] = useState(0)
  const contractFileInputRef = useRef<HTMLInputElement>(null)

  const centerQuery = useQuery<MillingCenter>({
    queryKey: ["admin-milling-center", centerId],
    enabled: !!centerId,
    queryFn: async () => {
      const res = await fetch(`/api/admin/milling/centers/${centerId}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load centre")
      const json = await res.json()
      return json.data
    },
  })
  const center = centerQuery.data

  // Reset the editable drafts whenever navigating to a different centre...
  useEffect(() => {
    setCompanyForm(null)
    setCoverageForm(null)
  }, [centerId])
  // ...then seed them from the server row exactly once per centre. Deliberately
  // NOT keyed on `center` alone — every mutation on this page (toggling Active,
  // toggling a service flow, uploading a contract doc) invalidates and refetches
  // the centre, which would otherwise wipe out any unsaved edits mid-typing.
  useEffect(() => {
    if (center && companyForm === null) setCompanyForm(companyFormFromCenter(center))
    if (center && coverageForm === null) setCoverageForm(coverageFormFromCenter(center))
  }, [center, companyForm, coverageForm])

  // Default the catalog tab to the first enabled flow, once, on first load.
  const [catalogTabInitialized, setCatalogTabInitialized] = useState(false)
  useEffect(() => { setCatalogTabInitialized(false) }, [centerId])
  useEffect(() => {
    if (center && !catalogTabInitialized) {
      if (center.enabledServiceTypes?.length) setCatalogTab(center.enabledServiceTypes[0] as ServiceType)
      setCatalogTabInitialized(true)
    }
  }, [center, catalogTabInitialized])

  const invalidateCenter = () => queryClient.invalidateQueries({ queryKey: ["admin-milling-center", centerId] })
  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ["admin-milling-centers"] })

  const patchCenter = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/milling/centers/${centerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || "Failed to save")
    }
    return res.json()
  }

  const companyMutation = useMutation({
    mutationFn: () => patchCenter(companyForm as CompanyForm),
    onSuccess: () => {
      invalidateCenter()
      invalidateList()
      toast.success("Company details saved")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const coverageMutation = useMutation({
    mutationFn: () =>
      patchCenter({
        statesServed: fromCsv(coverageForm?.statesServed ?? ""),
        avgTatDays: coverageForm?.avgTatDays === "" || coverageForm?.avgTatDays == null ? null : Number(coverageForm.avgTatDays),
      }),
    onSuccess: () => {
      invalidateCenter()
      invalidateList()
      toast.success("Coverage details saved")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const activeMutation = useMutation({
    mutationFn: (active: boolean) => patchCenter({ active }),
    onSuccess: () => {
      invalidateCenter()
      invalidateList()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const serviceTypesMutation = useMutation({
    mutationFn: (next: ServiceType[]) => patchCenter({ enabledServiceTypes: next }),
    onSuccess: () => {
      invalidateCenter()
      invalidateList()
      toast.success("Services offered updated")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleFlow = (flow: ServiceType, checked: boolean) => {
    const current = (center?.enabledServiceTypes ?? []) as ServiceType[]
    const next = checked ? [...current, flow] : current.filter((f) => f !== flow)
    serviceTypesMutation.mutate(next)
    if (checked) setCatalogTab(flow)
  }

  const handleContractUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !centerId) return
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File exceeds the 25MB limit")
      return
    }
    setContractUploading(true)
    setContractProgress(0)
    try {
      await uploadMillingCenterContract(file, centerId, setContractProgress)
      invalidateCenter()
      toast.success("Contract document uploaded")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setContractUploading(false)
      setContractProgress(0)
    }
  }

  const downloadContract = async () => {
    const res = await fetch(`/api/admin/milling/centers/${centerId}/contract`)
    if (!res.ok) {
      toast.error("Failed to get download link")
      return
    }
    const { url } = await res.json()
    window.open(url, "_blank")
  }

  const location = [center?.city, center?.state, center?.country].filter(Boolean).join(", ")
  const enabledFlows = (center?.enabledServiceTypes ?? []) as ServiceType[]

  if (centerId && !centerQuery.isLoading && !center) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Button variant="ghost" onClick={() => router.push("/admin/milling/centers")} className="px-0 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />Back to centres
        </Button>
        <p className="text-sm text-muted-foreground">Milling centre not found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" onClick={() => router.push("/admin/milling/centers")} className="px-0 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to centres
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{center?.name || "Centre details"}</h1>
            <p className="text-sm text-muted-foreground">Full centre profile and service catalog</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setManagingUsers(true)}>
            <Users className="h-3.5 w-3.5" />Manage users
          </Button>
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">Active</span>
            <Switch
              checked={center?.active ?? false}
              disabled={activeMutation.isPending || centerQuery.isLoading}
              onCheckedChange={(v) => activeMutation.mutate(v)}
            />
          </div>
          <Badge variant={center?.active ? "secondary" : "outline"}>{center?.active ? "Active" : "Inactive"}</Badge>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Company & Contacts */}
        <Card className="shadow-card">
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  Company & contacts
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Legal identity, points of contact and location.</p>
              </div>
              <Button
                size="sm" className="h-8 text-xs gap-1.5 shrink-0"
                onClick={() => companyMutation.mutate()}
                disabled={companyMutation.isPending || !companyForm}
              >
                <Save className="h-3.5 w-3.5" />
                {companyMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {!companyForm ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Company name *">
                    <Input value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
                  </Field>
                  <Field label="Company legal name">
                    <Input value={companyForm.legalName} onChange={(e) => setCompanyForm({ ...companyForm, legalName: e.target.value })} />
                  </Field>
                </div>

                <FieldGroup label="Lab owner">
                  <Field label="Name"><Input value={companyForm.ownerName} onChange={(e) => setCompanyForm({ ...companyForm, ownerName: e.target.value })} /></Field>
                  <Field label="Email"><Input value={companyForm.ownerEmail} onChange={(e) => setCompanyForm({ ...companyForm, ownerEmail: e.target.value })} /></Field>
                  <Field label="Phone"><Input value={companyForm.ownerPhone} onChange={(e) => setCompanyForm({ ...companyForm, ownerPhone: e.target.value })} /></Field>
                </FieldGroup>

                <FieldGroup label="Point of contact (milling portal login)">
                  <Field label="Name"><Input value={companyForm.contactName} onChange={(e) => setCompanyForm({ ...companyForm, contactName: e.target.value })} /></Field>
                  <Field label="Email"><Input value={companyForm.email} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} /></Field>
                  <Field label="Phone"><Input value={companyForm.phone} onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} /></Field>
                </FieldGroup>

                <FieldGroup label="Finance POC">
                  <Field label="Name"><Input value={companyForm.financePocName} onChange={(e) => setCompanyForm({ ...companyForm, financePocName: e.target.value })} /></Field>
                  <Field label="Email"><Input value={companyForm.financePocEmail} onChange={(e) => setCompanyForm({ ...companyForm, financePocEmail: e.target.value })} /></Field>
                  <Field label="Phone"><Input value={companyForm.financePocPhone} onChange={(e) => setCompanyForm({ ...companyForm, financePocPhone: e.target.value })} /></Field>
                </FieldGroup>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="City / HQ"><Input value={companyForm.city} onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })} /></Field>
                  <Field label="State"><Input value={companyForm.state} onChange={(e) => setCompanyForm({ ...companyForm, state: e.target.value })} /></Field>
                  <Field label="Country"><Input value={companyForm.country} onChange={(e) => setCompanyForm({ ...companyForm, country: e.target.value })} /></Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <Info label="Location" value={location || "—"} icon={<MapPin className="h-3 w-3" />} />
                  <Info label="Onboarded" value={center?.onboardedAt ? format(new Date(center.onboardedAt), "PPP") : "—"} icon={<CalendarDays className="h-3 w-3" />} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Contract document */}
        <Card className="shadow-card">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <FileText className="h-3.5 w-3.5 text-primary" />
              Contract document
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-2 flex-wrap">
              {center?.contractDocName ? (
                <Badge variant="secondary" className="gap-1 text-[11px]">
                  <FileText className="h-3 w-3" />{center.contractDocName}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">No contract document uploaded yet.</span>
              )}
              {center?.contractDocKey && (
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={downloadContract}>
                  <Download className="h-3.5 w-3.5" />Download
                </Button>
              )}
              <Button
                type="button" size="sm" variant="outline" className="h-7 text-xs gap-1"
                disabled={contractUploading || !centerId}
                onClick={() => contractFileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                {contractUploading ? `Uploading… ${contractProgress}%` : center?.contractDocKey ? "Replace" : "Upload"}
              </Button>
              <input
                ref={contractFileInputRef}
                type="file" accept=".pdf,.doc,.docx" className="hidden"
                onChange={handleContractUpload}
              />
            </div>
          </CardContent>
        </Card>

        {/* Coverage */}
        <Card className="shadow-card">
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  Coverage
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">States served and average turnaround.</p>
              </div>
              <Button
                size="sm" className="h-8 text-xs gap-1.5 shrink-0"
                onClick={() => coverageMutation.mutate()}
                disabled={coverageMutation.isPending || !coverageForm}
              >
                <Save className="h-3.5 w-3.5" />
                {coverageMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {!coverageForm ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="States served">
                  <Input
                    value={coverageForm.statesServed}
                    onChange={(e) => setCoverageForm({ ...coverageForm, statesServed: e.target.value })}
                    placeholder="CA, NY, TX or ALL"
                  />
                </Field>
                <Field label="Avg TAT (days)">
                  <Input
                    type="number" min="0"
                    value={coverageForm.avgTatDays}
                    onChange={(e) => setCoverageForm({ ...coverageForm, avgTatDays: e.target.value })}
                  />
                </Field>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Services offered */}
        <Card className="shadow-card">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Services offered
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Which flows this centre can be assigned. Changing this immediately affects routing eligibility.
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex flex-wrap gap-4">
            {FLOWS.map((flow) => (
              <div key={flow} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <Switch
                  checked={enabledFlows.includes(flow)}
                  disabled={serviceTypesMutation.isPending || centerQuery.isLoading}
                  onCheckedChange={(checked) => toggleFlow(flow, checked)}
                />
                <span className="text-xs font-semibold text-foreground">{FLOW_LABELS[flow]}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Service catalog */}
        <Card className="shadow-card">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <Wrench className="h-3.5 w-3.5 text-primary" />
              Service catalog
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rates, unit and monthly capacity this centre offers per flow.
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {!centerId ? (
              <p className="text-xs text-muted-foreground py-6 text-center">Loading…</p>
            ) : (
              <Tabs value={catalogTab} onValueChange={(v) => setCatalogTab(v as ServiceType)}>
                <TabsList>
                  {FLOWS.map((flow) => (
                    <TabsTrigger key={flow} value={flow} className="text-xs">{FLOW_LABELS[flow]}</TabsTrigger>
                  ))}
                </TabsList>
                {FLOWS.map((flow) => (
                  <TabsContent key={flow} value={flow} className="space-y-2">
                    {!enabledFlows.includes(flow) && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                        This flow is not enabled for this centre — it won&apos;t be eligible for routing until you enable it above.
                      </div>
                    )}
                    <MillingServiceCatalogTable centerId={centerId} serviceType={flow} />
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      <ManageUsersDialog center={center ?? null} open={managingUsers} onOpenChange={setManagingUsers} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-primary/70">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{children}</div>
    </div>
  )
}

function Info({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-xs font-semibold text-primary/70 flex items-center gap-1">{icon}{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{value}</p>
    </div>
  )
}