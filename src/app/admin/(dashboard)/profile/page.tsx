"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs"
import { PriceListTable } from "@/src/components/PriceListTable"
import { toast } from "sonner"
import { User, Mail, Phone, Shield, FileText, Save, RefreshCw } from "lucide-react"
import type { PriceListEntryFull } from "@/src/lib/price-list-shared"
import type { ServiceType } from "@/src/lib/case-status-mapping"

type AdminProfile = {
  id: string
  fullName: string | null
  email: string
  phone: string | null
  role: string
  title: string | null
  status: string
  createdAt: string
}

const FLOWS: ServiceType[] = ["design_only", "design_milling", "milling_only"]

const FLOW_LABELS: Record<ServiceType, string> = {
  design_only: "Design Only",
  design_milling: "Design + Milling",
  milling_only: "Milling Only",
}

async function fetchCatalog(serviceType: ServiceType, refresh = false): Promise<PriceListEntryFull[]> {
  const url = `/api/admin/service-catalog?serviceType=${serviceType}&includeInactive=true${refresh ? "&refresh=true" : ""}`
  const res = await fetch(url, refresh ? { cache: "no-store" } : undefined)
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(`${res.status}: ${payload.error ?? "Failed to load catalog"}`)
  }
  const json = await res.json()
  return json.data ?? []
}

export default function AdminProfilePage() {
  const queryClient = useQueryClient()
  const [priceListOpen, setPriceListOpen] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [refreshing, setRefreshing] = useState(false)

  const profileQuery = useQuery<AdminProfile>({
    queryKey: ["admin-me"],
    queryFn: async () => {
      const res = await fetch("/api/admin/me")
      if (!res.ok) throw new Error("Failed to load profile")
      return res.json()
    },
  })

  const [activeOverrides, setActiveOverrides] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<ServiceType>("design_only")

  const catalogQueries: Record<ServiceType, ReturnType<typeof useQuery<PriceListEntryFull[]>>> = {
    design_only: useQuery<PriceListEntryFull[]>({
      queryKey: ["admin-service-catalog", "design_only"],
      queryFn: () => fetchCatalog("design_only"),
    }),
    design_milling: useQuery<PriceListEntryFull[]>({
      queryKey: ["admin-service-catalog", "design_milling"],
      queryFn: () => fetchCatalog("design_milling"),
    }),
    milling_only: useQuery<PriceListEntryFull[]>({
      queryKey: ["admin-service-catalog", "milling_only"],
      queryFn: () => fetchCatalog("milling_only"),
    }),
  }

  const isLoading = FLOWS.some((flow) => catalogQueries[flow].isLoading)
  const isError = FLOWS.some((flow) => catalogQueries[flow].isError)

  const rowsWithOverrides = (flow: ServiceType) =>
    (catalogQueries[flow].data ?? []).map((row) => ({
      ...row,
      defaultPrice: row.catalogItemId in overrides ? overrides[row.catalogItemId] : row.defaultPrice,
      isActive: row.catalogItemId in activeOverrides ? activeOverrides[row.catalogItemId] : row.isActive,
    }))

  const updatePrice = (catalogItemId: string, price: number) => {
    setOverrides((prev) => ({ ...prev, [catalogItemId]: price }))
  }

  const updateActive = (catalogItemId: string, isActive: boolean) => {
    setActiveOverrides((prev) => ({ ...prev, [catalogItemId]: isActive }))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ids = new Set([...Object.keys(overrides), ...Object.keys(activeOverrides)])
      const allRows = FLOWS.flatMap((flow) => catalogQueries[flow].data ?? [])
      const items = Array.from(ids).map((id) => {
        const row = allRows.find((r) => r.catalogItemId === id)
        return {
          id,
          defaultPrice: overrides[id] ?? row?.defaultPrice ?? 0,
          isActive: id in activeOverrides ? activeOverrides[id] : undefined,
        }
      })
      const res = await fetch(`/api/admin/service-catalog?serviceType=${activeTab}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || "Failed to save")
      }
      return res.json()
    },
    onSuccess: async () => {
      setOverrides({})
      setActiveOverrides({})
      await queryClient.invalidateQueries({ queryKey: ["admin-service-catalog"] })
      toast.success("Default price list saved")
      setPriceListOpen(false)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    },
  })

  const handleOpen = () => {
    setOverrides({})
    setActiveOverrides({})
    setPriceListOpen(true)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const results = await Promise.all(FLOWS.map((flow) => fetchCatalog(flow, true)))
      FLOWS.forEach((flow, i) => queryClient.setQueryData(["admin-service-catalog", flow], results[i]))
      toast.success("Refreshed directly from the database")
    } catch {
      toast.error("Failed to refresh")
    } finally {
      setRefreshing(false)
    }
  }

  const profile = profileQuery.data

  return (
    <>
      <div className="space-y-6 animate-fade-in max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Profile</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Account details and default price list settings</p>
        </div>

        {/* Profile Info */}
        <Card className="shadow-card">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="h-3.5 w-3.5 text-primary" />
              Account Information
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Info label="Full Name" value={profile?.fullName || "—"} icon={<User className="h-3 w-3" />} />
            <Info label="Email" value={profile?.email || "—"} icon={<Mail className="h-3 w-3" />} />
            <Info label="Phone" value={profile?.phone || "—"} icon={<Phone className="h-3 w-3" />} />
            <Info label="Title" value={profile?.title || "—"} />
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-primary/70 flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Role
                </p>
                <p className="mt-0.5 text-xs font-semibold text-foreground capitalize">{profile?.role || "—"}</p>
              </div>
              <Badge variant="secondary" className="capitalize text-[10px]">
                {profile?.status || "—"}
              </Badge>
            </div>
            <Info
              label="Member Since"
              value={profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"}
            />
          </CardContent>
        </Card>

        {/* Default Price List */}
        <Card className="shadow-card">
          <CardHeader className="pb-3 pt-3 px-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  Default Price List
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Default Design and Design + Milling prices applied to every newly approved client.
                  You can override prices per-client from the client profile.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs font-semibold gap-1.5"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh from DB
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold gap-1.5"
                  onClick={handleOpen}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Edit Default Prices
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
            ) : isError ? (
              <p className="text-xs text-destructive text-center py-4">Failed to load price list</p>
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
                  <TabsContent key={flow} value={flow}>
                    <PriceListTable rows={catalogQueries[flow].data ?? []} mode="system" />
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Default Price List Modal */}
      <Dialog open={priceListOpen} onOpenChange={(v) => !v && setPriceListOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-primary" />
              Edit Default Price List — {FLOW_LABELS[activeTab]}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Changes here update the default prices and enable state applied to newly approved clients. Existing client prices are not affected.
            </p>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ServiceType)}>
              <TabsList>
                {FLOWS.map((flow) => (
                  <TabsTrigger key={flow} value={flow} className="text-xs">
                    {FLOW_LABELS[flow]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {FLOWS.map((flow) => (
                <TabsContent key={flow} value={flow}>
                  <PriceListTable rows={rowsWithOverrides(flow)} mode="system" onChangePrice={updatePrice} onToggleEnabled={updateActive} />
                </TabsContent>
              ))}
            </Tabs>

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || (Object.keys(overrides).length === 0 && Object.keys(activeOverrides).length === 0)}
                className="gap-1.5 gradient-primary border-none shadow-glow text-xs h-8"
              >
                <Save className="h-3.5 w-3.5" />
                Save Default Prices
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Info({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-xs font-semibold text-primary/70 flex items-center gap-1">{icon}{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-foreground">{value}</p>
    </div>
  )
}