"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { toast } from "sonner"
import { Switch } from "@/src/components/ui/switch"
import { ArrowLeft, Building2, Save, Plus, Mail, Phone, MapPin, CalendarDays, User, ShieldCheck, Layers3 } from "lucide-react"
import { PriceListTable, type PriceListRow } from "@/src/components/PriceListTable"

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
  userType: string
  role: string
  title: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  onBoardedAt: string | null
}

type PriceListItemRecord = {
  id: string
  serviceName: string
  subCategory: string
  price: number
  notes: string | null
  sortOrder: number
}

function createBlankRow(): PriceListRow {
  return {
    id: crypto.randomUUID(),
    serviceName: "",
    subCategory: "",
    price: 0,
    notes: "",
    sortOrder: 0,
  }
}

export default function ClientProfilePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useParams<{ id: string }>()
  const clientId = Array.isArray(params?.id) ? params.id[0] : params?.id
  const [priceRows, setPriceRows] = useState<PriceListRow[]>([])

  const clientQuery = useQuery<ClientProfile>({
    queryKey: ["admin-client", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/admin/clients/${clientId}`)
      if (!res.ok) throw new Error("Failed to load client")
      const json = await res.json()
      return json.data
    },
  })

  const priceListQuery = useQuery<PriceListItemRecord[]>({
    queryKey: ["admin-client-price-list", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/admin/clients/${clientId}/price-list`)
      if (!res.ok) throw new Error("Failed to load price list")
      const json = await res.json()
      return json.data ?? []
    },
  })

  useEffect(() => {
    const nextRows = (priceListQuery.data ?? []).map((item) => ({
      id: item.id,
      serviceName: item.serviceName,
      subCategory: item.subCategory ?? "",
      price: item.price,
      notes: item.notes ?? "",
      sortOrder: item.sortOrder,
    }))
    setPriceRows(nextRows)
  }, [priceListQuery.data])

  const saveMutation = useMutation({
    mutationFn: async (items: PriceListRow[]) => {
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
      await queryClient.invalidateQueries({ queryKey: ["admin-client-price-list", clientId] })
      toast.success("Price list saved")
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to save price list")
    },
  })

  const updateRow = (id: string, field: "serviceName" | "subCategory" | "price" | "notes", value: string | number) => {
    setPriceRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
            ...row,
            [field]: field === "price" ? Number(value) : value,
          }
          : row
      )
    )
  }

  const addRow = () => {
    setPriceRows((current) => [
      ...current,
      {
        ...createBlankRow(),
        sortOrder: current.length,
      },
    ])
  }

  const removeRow = (id: string) => {
    setPriceRows((current) =>
      current
        .filter((row) => row.id !== id)
        .map((row, index) => ({ ...row, sortOrder: index }))
    )
  }

  const client = clientQuery.data
  const location = [client?.city, client?.state, client?.country].filter(Boolean).join(", ")

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Button variant="ghost" onClick={() => router.push("/admin/clients")} className="px-0 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to clients
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{client?.labName || "Client details"}</h1>
              <p className="text-sm text-muted-foreground">Full client profile and editable price list</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {client?.status || "unknown"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="shadow-card">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                Client information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-2 px-4 pb-4">
              <Info label="Client ID" value={client?.id ?? "Loading..."} />
              <Info label="Lab Name" value={client?.labName || "-"} />
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
                  <p className="text-xs font-semibold text-primary/70 flex items-center gap-1">
                    {/* <Layers3 className="h-3 w-3" /> */}
                    Plan
                  </p>
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
              <Info label="Created By" value={client?.createdBy || "-"} />
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Price list editor
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add or update services for this client. The client profile will reflect these changes immediately after save.
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex items-center justify-end gap-3 mb-3 px-1">
                <Button onClick={addRow} variant="outline" size="sm" className="gap-1.5 shrink-0 text-xs h-8">
                  <Plus className="h-3.5 w-3.5" />
                  Add service
                </Button>
                <Button onClick={() => saveMutation.mutate(priceRows)} disabled={saveMutation.isPending} size="sm" className="gap-1.5 gradient-primary border-none shadow-glow text-xs h-8">
                  <Save className="h-3.5 w-3.5" />
                  Save price list
                </Button>
              </div>

              <PriceListTable
                items={priceRows}
                editable
                onChangeRow={updateRow}
                onAddRow={addRow}
                onRemoveRow={removeRow}
                emptyState={
                  <div className="space-y-2 text-center py-6">
                    <p className="text-xs text-muted-foreground">No services have been added yet.</p>
                    <Button onClick={addRow} variant="outline" size="sm" className="gap-1.5 text-xs">
                      <Plus className="h-3.5 w-3.5" />
                      Add first service
                    </Button>
                  </div>
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  )
}

function Info({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-xs font-semibold text-primary/70 flex items-center gap-1">
        {/* {icon} */}
        {label}
      </p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{value}</p>
    </div>
  )
}
