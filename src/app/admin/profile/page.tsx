"use client"

import { useState, useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog"
import { PriceListTable, type PriceListRow } from "@/src/components/PriceListTable"
import { toast } from "sonner"
import { User, Mail, Phone, Shield, FileText, Save } from "lucide-react"
import type { PriceListEntryFull } from "@/src/lib/price-list"

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

function toCatalogRow(item: PriceListEntryFull): PriceListRow {
  return {
    id: item.id,
    catalogItemId: item.catalogItemId,
    category: item.category,
    subCategory: item.subCategory,
    unitType: item.unitType,
    defaultPrice: item.defaultPrice,
    price: item.defaultPrice,
    notes: null,
    sortOrder: item.sortOrder,
  }
}

export default function AdminProfilePage() {
  const queryClient = useQueryClient()
  const [priceListOpen, setPriceListOpen] = useState(false)
  const [catalogRows, setCatalogRows] = useState<PriceListRow[]>([])
  const [catalogInitialized, setCatalogInitialized] = useState(false)

  const profileQuery = useQuery<AdminProfile>({
    queryKey: ["admin-me"],
    queryFn: async () => {
      const res = await fetch("/api/admin/me")
      if (!res.ok) throw new Error("Failed to load profile")
      return res.json()
    },
  })

  const catalogQuery = useQuery<PriceListEntryFull[]>({
    queryKey: ["admin-service-catalog"],
    queryFn: async () => {
      const res = await fetch("/api/admin/service-catalog")
      if (!res.ok) throw new Error("Failed to load catalog")
      const json = await res.json()
      return json.data ?? []
    },
  })

  useEffect(() => {
    if (catalogQuery.data && !catalogInitialized) {
      setCatalogRows(catalogQuery.data.map(toCatalogRow))
      setCatalogInitialized(true)
    }
  }, [catalogQuery.data, catalogInitialized])

  const saveMutation = useMutation({
    mutationFn: async (rows: PriceListRow[]) => {
      const res = await fetch("/api/admin/service-catalog", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: rows.map((row) => ({
            id: row.catalogItemId,
            defaultPrice: row.price,
          })),
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || "Failed to save")
      }
      return res.json()
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-service-catalog"] })
      if (data?.data) {
        setCatalogRows((data.data as PriceListEntryFull[]).map(toCatalogRow))
      }
      toast.success("Default price list saved")
      setPriceListOpen(false)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    },
  })

  const updatePrice = (catalogItemId: string, price: number) => {
    setCatalogRows((current) =>
      current.map((row) =>
        row.catalogItemId === catalogItemId ? { ...row, price } : row
      )
    )
  }

  const handleOpen = () => setPriceListOpen(true)

  const profile = profileQuery.data

  return (
    <AdminLayout>
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
                  These are the default prices applied to every newly approved client.
                  You can override prices per-client from the client profile.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs font-semibold gap-1.5 shrink-0"
                onClick={handleOpen}
              >
                <FileText className="h-3.5 w-3.5" />
                Edit Default Prices
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {catalogQuery.isLoading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
            ) : catalogQuery.isError ? (
              <p className="text-xs text-destructive text-center py-4">
                Error: {(catalogQuery.error as Error)?.message ?? 'Failed to load price list'}
              </p>
            ) : (
              <PriceListTable items={catalogQuery.data?.map(toCatalogRow) ?? []} />
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
            <PriceListTable
              items={catalogRows}
              editable
              hideDefaultColumn
              onChangePrice={updatePrice}
            />

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate(catalogRows)}
                disabled={saveMutation.isPending}
                className="gap-1.5 gradient-primary border-none shadow-glow text-xs h-8"
              >
                <Save className="h-3.5 w-3.5" />
                Save Default Prices
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
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
