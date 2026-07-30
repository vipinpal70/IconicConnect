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
import { PriceListTable, type PriceColumnConfig } from "@/src/components/PriceListTable"
import { toast } from "sonner"
import { User, Mail, Phone, Shield, FileText, Save, RefreshCw } from "lucide-react"
import type { PriceListEntryFull } from "@/src/lib/price-list-shared"
import { mergeByServiceType } from "@/src/lib/price-list-shared"

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

const VIEW_COLUMNS: PriceColumnConfig[] = [
  { key: "defaultDesign", label: "Design Price" },
  { key: "defaultMilling", label: "D+Milling Price" },
]

const EDIT_COLUMNS: PriceColumnConfig[] = [
  { key: "defaultDesign", label: "Design Price", editable: true },
  { key: "defaultMilling", label: "D+Milling Price", editable: true },
]

async function fetchCatalog(serviceType: "design_only" | "design_milling", refresh = false): Promise<PriceListEntryFull[]> {
  const url = `/api/admin/service-catalog?serviceType=${serviceType}${refresh ? "&refresh=true" : ""}`
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

  const designOnlyQuery = useQuery<PriceListEntryFull[]>({
    queryKey: ["admin-service-catalog", "design_only"],
    queryFn: () => fetchCatalog("design_only"),
  })

  const designMillingQuery = useQuery<PriceListEntryFull[]>({
    queryKey: ["admin-service-catalog", "design_milling"],
    queryFn: () => fetchCatalog("design_milling"),
  })

  const isLoading = designOnlyQuery.isLoading || designMillingQuery.isLoading
  const isError = designOnlyQuery.isError || designMillingQuery.isError

  const mergedRows = mergeByServiceType(designOnlyQuery.data ?? [], designMillingQuery.data ?? [])
  const rowsWithOverrides = mergedRows.map((row) => ({
    ...row,
    designOnly: row.designOnly && row.designOnly.catalogItemId in overrides
      ? { ...row.designOnly, defaultPrice: overrides[row.designOnly.catalogItemId] }
      : row.designOnly,
    designMilling: row.designMilling && row.designMilling.catalogItemId in overrides
      ? { ...row.designMilling, defaultPrice: overrides[row.designMilling.catalogItemId] }
      : row.designMilling,
  }))

  const updatePrice = (catalogItemId: string, price: number) => {
    setOverrides((prev) => ({ ...prev, [catalogItemId]: price }))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = Object.entries(overrides).map(([id, defaultPrice]) => ({ id, defaultPrice }))
      const res = await fetch("/api/admin/service-catalog", {
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
    setPriceListOpen(true)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const [designOnly, designMilling] = await Promise.all([
        fetchCatalog("design_only", true),
        fetchCatalog("design_milling", true),
      ])
      queryClient.setQueryData(["admin-service-catalog", "design_only"], designOnly)
      queryClient.setQueryData(["admin-service-catalog", "design_milling"], designMilling)
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
              <PriceListTable rows={mergedRows} columns={VIEW_COLUMNS} />
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
              Edit Default Price List
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Changes here update the default prices applied to newly approved clients. Existing client prices are not affected.
            </p>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            <PriceListTable rows={rowsWithOverrides} columns={EDIT_COLUMNS} onChangePrice={updatePrice} />

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || Object.keys(overrides).length === 0}
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