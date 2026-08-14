/* eslint-disable react-hooks/set-state-in-effect */
"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { toast } from "sonner"
import { Switch } from "@/src/components/ui/switch"
import { ArrowLeft, Building2, Save, Mail, Phone, MapPin, CalendarDays, User, ShieldCheck, FileText, ChevronDown, ChevronUp, RefreshCw } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs"
import { PriceListTable } from "@/src/components/PriceListTable"
import type { PreferenceFormRecord } from "@/src/lib/preference-forms"
import type { PriceListEntryFull } from "@/src/lib/price-list-shared"
import type { ServiceType } from "@/src/lib/case-status-mapping"

type ClientProfile = {
  id: string
  fullName: string | null
  email: string
  labName: string | null
  phone: string | null
  city: string | null
  state: string | null
  country: string | null
  postalCode: string | null
  status: string
  plan: string | null
  modelOnlyLab: boolean
  userType: string
  role: string
  title: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  onBoardedAt: string | null
}

const FLOWS: ServiceType[] = ["design_only", "design_milling", "milling_only"]

const FLOW_LABELS: Record<ServiceType, string> = {
  design_only: "Design Only",
  design_milling: "Design + Milling",
  milling_only: "Milling Only",
}

async function fetchClientPriceList(
  clientId: string,
  serviceType: ServiceType,
  refresh = false
): Promise<PriceListEntryFull[]> {
  const url = `/api/admin/clients/${clientId}/price-list?serviceType=${serviceType}&includeInactive=true${refresh ? "&refresh=true" : ""}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error("Failed to load price list")
  const json = await res.json()
  return json.data ?? []
}

export default function ClientProfilePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useParams<{ id: string }>()
  const clientId = Array.isArray(params?.id) ? params.id[0] : params?.id

  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [enabledOverrides, setEnabledOverrides] = useState<Record<string, boolean>>({})
  const [refreshingPrices, setRefreshingPrices] = useState(false)
  const [activeTab, setActiveTab] = useState<ServiceType>("design_only")

  const clientQuery = useQuery<ClientProfile>({
    queryKey: ["admin-client", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/admin/clients/${clientId}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load client")
      const json = await res.json()
      return json.data
    },
  })

  const serviceTypesQuery = useQuery<ServiceType[]>({
    queryKey: ["admin-client-service-types", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/admin/clients/${clientId}/service-types`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load enabled flows")
      const json = await res.json()
      return json.data?.enabledServiceTypes ?? ["design_only"]
    },
  })

  const serviceTypesMutation = useMutation({
    mutationFn: async (next: ServiceType[]) => {
      const res = await fetch(`/api/admin/clients/${clientId}/service-types`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledServiceTypes: next }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || "Failed to update enabled flows")
      }
      return res.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-client-service-types", clientId] })
      toast.success("Enabled flows updated")
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to update enabled flows")
    },
  })

  // Active/Inactive toggle. Turning it on from "pending" runs the full
  // approve flow (seeds the default price list + sends the welcome
  // notification) instead of a bare status PATCH, so nothing skips those
  // side effects; every other transition is a plain status PATCH.
  const activeMutation = useMutation({
    mutationFn: async (nextActive: boolean) => {
      if (nextActive && client?.status === "pending") {
        const res = await fetch("/api/admin/clients/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          throw new Error(payload.error || "Failed to approve client")
        }
        return res.json()
      }
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextActive ? "active" : "inactive" }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || "Failed to update status")
      }
      return res.json()
    },
    onSuccess: async (_data, nextActive) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-client", clientId] })
      await queryClient.invalidateQueries({ queryKey: ["pendingClients"] })
      toast.success(nextActive ? "Client activated" : "Client deactivated")
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to update status")
    },
  })

  const modelOnlyLabMutation = useMutation({
    mutationFn: async (modelOnlyLab: boolean) => {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelOnlyLab }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || "Failed to update restriction")
      }
      return res.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-client", clientId] })
      toast.success("Restriction updated")
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to update restriction")
    },
  })

  const toggleFlow = (flow: ServiceType, checked: boolean) => {
    const current = serviceTypesQuery.data ?? ["design_only"]
    const next = checked ? [...current, flow] : current.filter((f) => f !== flow)
    if (next.length === 0) {
      toast.error("A client must have at least one enabled service flow")
      return
    }
    serviceTypesMutation.mutate(next)
  }

  const priceListQueries: Record<ServiceType, ReturnType<typeof useQuery<PriceListEntryFull[]>>> = {
    design_only: useQuery<PriceListEntryFull[]>({
      queryKey: ["admin-client-price-list", clientId, "design_only"],
      enabled: !!clientId,
      queryFn: () => fetchClientPriceList(clientId!, "design_only"),
    }),
    design_milling: useQuery<PriceListEntryFull[]>({
      queryKey: ["admin-client-price-list", clientId, "design_milling"],
      enabled: !!clientId,
      queryFn: () => fetchClientPriceList(clientId!, "design_milling"),
    }),
    milling_only: useQuery<PriceListEntryFull[]>({
      queryKey: ["admin-client-price-list", clientId, "milling_only"],
      enabled: !!clientId,
      queryFn: () => fetchClientPriceList(clientId!, "milling_only"),
    }),
  }

  // Reset unsaved edits when navigating between client profiles
  useEffect(() => {
    setOverrides({})
    setEnabledOverrides({})
  }, [clientId])

  const rowsWithOverrides = (flow: ServiceType) =>
    (priceListQueries[flow].data ?? []).map((row) => ({
      ...row,
      price: row.catalogItemId in overrides ? overrides[row.catalogItemId] : row.price,
      isEnabled: row.catalogItemId in enabledOverrides ? enabledOverrides[row.catalogItemId] : row.isEnabled,
    }))

  const findNotes = (catalogItemId: string): string | null => {
    const all = FLOWS.flatMap((flow) => priceListQueries[flow].data ?? [])
    return all.find((r) => r.catalogItemId === catalogItemId)?.notes ?? null
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ids = new Set([...Object.keys(overrides), ...Object.keys(enabledOverrides)])
      const allRows = FLOWS.flatMap((flow) => priceListQueries[flow].data ?? [])
      const items = Array.from(ids).map((catalogItemId) => {
        const row = allRows.find((r) => r.catalogItemId === catalogItemId)
        return {
          catalogItemId,
          price: overrides[catalogItemId] ?? row?.price ?? 0,
          notes: findNotes(catalogItemId),
          isEnabled: catalogItemId in enabledOverrides ? enabledOverrides[catalogItemId] : undefined,
        }
      })
      const res = await fetch(`/api/admin/clients/${clientId}/price-list`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || "Failed to save price list")
      }
      return res.json()
    },
    onSuccess: async () => {
      setOverrides({})
      setEnabledOverrides({})
      await queryClient.invalidateQueries({ queryKey: ["admin-client-price-list", clientId] })
      toast.success("Price list saved")
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to save price list")
    },
  })

  const updatePrice = (catalogItemId: string, price: number) => {
    setOverrides((prev) => ({ ...prev, [catalogItemId]: price }))
  }

  const updateEnabled = (catalogItemId: string, isEnabled: boolean) => {
    setEnabledOverrides((prev) => ({ ...prev, [catalogItemId]: isEnabled }))
  }

  const handleRefreshPrices = async () => {
    setRefreshingPrices(true)
    try {
      const results = await Promise.all(FLOWS.map((flow) => fetchClientPriceList(clientId!, flow, true)))
      FLOWS.forEach((flow, i) => queryClient.setQueryData(["admin-client-price-list", clientId, flow], results[i]))
      toast.success("Refreshed directly from the database")
    } catch {
      toast.error("Failed to refresh")
    } finally {
      setRefreshingPrices(false)
    }
  }

  const prefFormsQuery = useQuery<PreferenceFormRecord[]>({
    queryKey: ["admin-client-pref-forms", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/preference-forms?clientId=${clientId}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load preference forms")
      const json = await res.json()
      return json.data ?? []
    },
  })

  const client = clientQuery.data
  const location = [client?.city, client?.state, client?.country].filter(Boolean).join(", ")
  const priceListLoading = FLOWS.some((flow) => priceListQueries[flow].isLoading)
  const enabledFlows = serviceTypesQuery.data ?? ["design_only"]

  return (
    
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Button variant="ghost" onClick={() => router.push("/admin/clients")} className="px-0 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to clients
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{client?.labName || "Client details"}</h1>
              <p className="text-sm text-muted-foreground">Full client profile and price list editor</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">Active</span>
              <Switch
                checked={client?.status === "active"}
                disabled={activeMutation.isPending || clientQuery.isLoading}
                onCheckedChange={(v) => activeMutation.mutate(v)}
              />
            </div>
            <Badge variant={client?.status === "active" ? "secondary" : "outline"} className="capitalize">
              {client?.status === "pending" ? "Pending Approval" : client?.status || "unknown"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Client Information */}
          <Card className="shadow-card">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                Client information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-2 px-4 pb-4">
              <Info label="Lab Name" value={client?.labName || "-"} />
              <Info label="Services" value={enabledFlows.map((f) => FLOW_LABELS[f]).join(", ") || "-"} />
              <Info label="Primary Contact" value={client?.fullName || "-"} />
              <Info label="Email" value={client?.email || "-"} icon={<Mail className="h-3 w-3" />} />
              <Info label="Phone" value={client?.phone || "-"} icon={<Phone className="h-3 w-3" />} />
              <Info label="Location" value={location || "-"} icon={<MapPin className="h-3 w-3" />} />
              <Info label="Postal Code" value={client?.postalCode || "-"} />
              <Info label="Title" value={client?.title || "-"} />
              <Info label="Role" value={client?.role || "-"} icon={<User className="h-3 w-3" />} />
              <Info label="User Type" value={client?.userType || "-"} />

              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between col-span-1 sm:col-span-2 md:col-span-1">
                <div>
                  <p className="text-xs font-semibold text-primary/70">Plan</p>
                  <p className="mt-0.5 truncate text-xs font-semibold text-foreground">
                    {client?.plan || "Trial"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-muted-foreground font-medium">Trial</span>
                  <Switch
                    className="scale-75 origin-right"
                    checked={client?.plan === "Onboarded"}
                    onCheckedChange={async (checked) => {
                      if (!client) return
                      try {
                        const nextPlan = checked ? "Onboarded" : "Trial"
                        const res = await fetch(`/api/admin/clients/plan`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ clientId: client.id, plan: nextPlan }),
                        })
                        if (!res.ok) {
                          const payload = await res.json().catch(() => ({}))
                          throw new Error(payload.error || "Failed to update plan")
                        }
                        toast.success(`Plan updated to ${nextPlan}`)
                        await queryClient.invalidateQueries({ queryKey: ["admin-client", clientId] })
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed to update plan")
                      }
                    }}
                  />
                  <span className="text-[10px] text-primary font-bold">Onboarded</span>
                </div>
              </div>

              <Info label="Onboarded" value={client?.onBoardedAt ? format(new Date(client.onBoardedAt), "PPP") : "-"} />
              <Info label="Created" value={client?.createdAt ? format(new Date(client.createdAt), "PPP") : "-"} icon={<CalendarDays className="h-3 w-3" />} />
              <Info label="Updated" value={client?.updatedAt ? format(new Date(client.updatedAt), "PPP") : "-"} />
            </CardContent>
          </Card>

          {/* Enabled Flows */}
          <Card className="shadow-card">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Enabled flows
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Which case-submission flows this client can use. Changing this immediately affects what they can submit and see priced.
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex flex-wrap gap-4">
              {FLOWS.map((flow) => (
                <div key={flow} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <Switch
                    checked={enabledFlows.includes(flow)}
                    disabled={serviceTypesMutation.isPending || serviceTypesQuery.isLoading}
                    onCheckedChange={(checked) => toggleFlow(flow, checked)}
                  />
                  <span className="text-xs font-semibold text-foreground">{FLOW_LABELS[flow]}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 3D Model Only Restriction */}
          <Card className="shadow-card">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                3D Model only
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                When on, this lab can only create &quot;3D Model&quot; category cases — every other category is hidden for them.
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 w-fit">
                <Switch
                  checked={client?.modelOnlyLab ?? false}
                  disabled={modelOnlyLabMutation.isPending || clientQuery.isLoading}
                  onCheckedChange={(checked) => modelOnlyLabMutation.mutate(checked)}
                />
                <span className="text-xs font-semibold text-foreground">Restrict to 3D Model cases only</span>
              </div>
            </CardContent>
          </Card>

          {/* Price List Editor */}
          <Card className="shadow-card">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    Allocated price list
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Edit client-specific prices per flow. Changes are reflected in the client portal immediately after save.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs h-8"
                    onClick={handleRefreshPrices}
                    disabled={refreshingPrices}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshingPrices ? "animate-spin" : ""}`} />
                    Refresh from DB
                  </Button>
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || priceListLoading || (Object.keys(overrides).length === 0 && Object.keys(enabledOverrides).length === 0)}
                    size="sm"
                    className="gap-1.5 gradient-primary border-none shadow-glow text-xs h-8"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save price list
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {priceListLoading ? (
                <p className="text-xs text-muted-foreground py-6 text-center">Loading...</p>
              ) : (
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ServiceType)}>
                  <TabsList>
                    {FLOWS.map((flow) => (
                      <TabsTrigger key={flow} value={flow} className="text-xs">
                        {FLOW_LABELS[flow]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {FLOWS.map((flow) => (
                    <TabsContent key={flow} value={flow} className="space-y-2">
                      {!enabledFlows.includes(flow) && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                          This flow is not enabled for this client — they won&apos;t see it until you enable it above.
                        </div>
                      )}
                      <PriceListTable
                        rows={rowsWithOverrides(flow)}
                        mode="client"
                        onChangePrice={updatePrice}
                        onToggleEnabled={updateEnabled}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </CardContent>
          </Card>

          {/* Preference Forms */}
          <Card className="shadow-card">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  Preference Forms
                </CardTitle>
                <Badge variant="secondary" className="text-[10px]">
                  {prefFormsQuery.isLoading ? "Loading..." : `${prefFormsQuery.data?.length ?? 0} form(s)`}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Preference forms submitted by this client.
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {prefFormsQuery.isLoading ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading...</p>
              ) : !prefFormsQuery.data?.length ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No preference forms submitted yet.</p>
              ) : (
                <div className="grid gap-3">
                  {prefFormsQuery.data.map((form) => (
                    <PrefFormCard key={form.id} form={form} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    
  )
}

function Info({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-xs font-semibold text-primary/70 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{value}</p>
    </div>
  )
}

function PrefFormCard({ form }: { form: PreferenceFormRecord }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-border/50 bg-muted/[0.02] overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-muted/20 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <p className="text-xs font-semibold text-foreground">{form.formName}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Submitted {new Date(form.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-3.5 py-3">
          <div className="grid gap-2 text-xs md:grid-cols-2">
            <Summary label="Occlusion" value={form.payload.occlusion.defaultValues || "-"} />
            <Summary label="Proximal Contacts" value={form.payload.proximalContacts.defaultValues || "-"} />
            <Summary label="Distal-most Crown" value={form.payload.distalMostCrownContact.defaultValues || "-"} />
            <Summary label="Anatomy" value={form.payload.anatomy.option || "-"} />
            <Summary label="Smile Library" value={form.payload.smileLibrary.option || "-"} />
            <Summary label="Pontic Type" value={form.payload.ponticType.option || "-"} />
            <Summary label="Pontic Distance" value={form.payload.ponticDistanceFromTissue.option || "-"} />
            <Summary label="Match Marginal Ridge" value={form.payload.matchMarginalRidge.option || "-"} />
            <Summary label="Posterior Cutback" value={form.payload.posteriorCutback?.option || "-"} />
            <Summary label="Anterior Cutback" value={form.payload.anteriorCutback?.option || "-"} />
            <Summary
              label="Coping Pontic Distance"
              value={
                [
                  form.payload.copingPonticDistanceFromTissue?.option,
                  form.payload.copingPonticDistanceFromTissue?.distanceMm
                    ? `${form.payload.copingPonticDistanceFromTissue.distanceMm}mm`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "-"
              }
            />
            <Summary label="Collar Type" value={form.payload.copingCollarType?.option || "-"} />
            <Summary label="Create Island" value={form.payload.copingCreateIsland?.option || "-"} />
            <Summary label="Preferred Software" value={form.payload.preferredSoftware?.option || "-"} />
            <Summary
              label="Image 1"
              value={
                form.payload.uploadedImage1 ? (
                  <a
                    href={form.payload.uploadedImage1.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-bold"
                  >
                    {form.payload.uploadedImage1.fileName}
                  </a>
                ) : (
                  "-"
                )
              }
            />
            <Summary
              label="Image 2"
              value={
                form.payload.uploadedImage2 ? (
                  <a
                    href={form.payload.uploadedImage2.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-bold"
                  >
                    {form.payload.uploadedImage2.fileName}
                  </a>
                ) : (
                  "-"
                )
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-border/50 bg-muted/20 px-2.5 py-1.5">
      <p className="text-[9px] font-bold tracking-wider text-muted-foreground">{label}</p>
      <div className="truncate text-[11px] text-foreground font-semibold mt-0.5">{value}</div>
    </div>
  )
}
