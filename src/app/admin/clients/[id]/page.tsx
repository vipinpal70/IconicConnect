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
import { ArrowLeft, Building2, Save, Mail, Phone, MapPin, CalendarDays, User, ShieldCheck, FileText, ChevronDown, ChevronUp } from "lucide-react"
import { PriceListTable, type PriceListRow } from "@/src/components/PriceListTable"
import type { PreferenceFormRecord } from "@/src/lib/preference-forms"
import type { PriceListEntryFull } from "@/src/lib/price-list"

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

function toPriceListRow(item: PriceListEntryFull): PriceListRow {
  return {
    id: item.id,
    catalogItemId: item.catalogItemId,
    category: item.category,
    subCategory: item.subCategory,
    unitType: item.unitType,
    defaultPrice: item.defaultPrice,
    price: item.price,
    notes: item.notes,
    sortOrder: item.sortOrder,
  }
}

export default function ClientProfilePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useParams<{ id: string }>()
  const clientId = Array.isArray(params?.id) ? params.id[0] : params?.id

  const [priceRows, setPriceRows] = useState<PriceListRow[]>([])
  const [priceListInitialized, setPriceListInitialized] = useState(false)

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

  const priceListQuery = useQuery<PriceListEntryFull[]>({
    queryKey: ["admin-client-price-list", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/admin/clients/${clientId}/price-list`)
      if (!res.ok) throw new Error("Failed to load price list")
      const json = await res.json()
      return json.data ?? []
    },
  })

  const catalogQuery = useQuery<PriceListEntryFull[]>({
    queryKey: ["admin-service-catalog"],
    enabled: priceListQuery.isSuccess && priceListQuery.data?.length === 0,
    queryFn: async () => {
      const res = await fetch("/api/admin/service-catalog")
      if (!res.ok) throw new Error("Failed to load catalog")
      const json = await res.json()
      return json.data ?? []
    },
  })

  // Populate price rows from the fetched price list (or fall back to catalog defaults)
  useEffect(() => {
    if (!priceListQuery.isSuccess || priceListInitialized) return

    if (priceListQuery.data.length > 0) {
      setPriceRows(priceListQuery.data.map(toPriceListRow))
      setPriceListInitialized(true)
    }
  }, [priceListQuery.isSuccess, priceListQuery.data, priceListInitialized])

  useEffect(() => {
    if (!catalogQuery.isSuccess || priceListInitialized) return
    if (catalogQuery.data.length > 0) {
      setPriceRows(catalogQuery.data.map(toPriceListRow))
      setPriceListInitialized(true)
    }
  }, [catalogQuery.isSuccess, catalogQuery.data, priceListInitialized])

  const saveMutation = useMutation({
    mutationFn: async (items: PriceListRow[]) => {
      const res = await fetch(`/api/admin/clients/${clientId}/price-list`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((row) => ({
            catalogItemId: row.catalogItemId,
            price: row.price,
            notes: row.notes,
          })),
        }),
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

  const updatePrice = (catalogItemId: string, price: number) => {
    setPriceRows((current) =>
      current.map((row) =>
        row.catalogItemId === catalogItemId ? { ...row, price } : row
      )
    )
  }

  const prefFormsQuery = useQuery<PreferenceFormRecord[]>({
    queryKey: ["admin-client-pref-forms", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/preference-forms?clientId=${clientId}`)
      if (!res.ok) throw new Error("Failed to load preference forms")
      const json = await res.json()
      return json.data ?? []
    },
  })

  const client = clientQuery.data
  const location = [client?.city, client?.state, client?.country].filter(Boolean).join(", ")
  const isDefaultPrices = priceListQuery.isSuccess && priceListQuery.data?.length === 0 && priceRows.length > 0

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
              <p className="text-sm text-muted-foreground">Full client profile and price list editor</p>
            </div>
          </div>

          <Badge variant="outline" className="capitalize">
            {client?.status || "unknown"}
          </Badge>
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
              <Info label="Created By" value={client?.createdBy || "-"} />
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
                    {isDefaultPrices
                      ? "No price list found — showing catalog defaults. Save to confirm."
                      : "Edit client-specific prices. Changes are reflected in the client portal immediately after save."}
                  </p>
                </div>
                <Button
                  onClick={() => saveMutation.mutate(priceRows)}
                  disabled={saveMutation.isPending || priceListQuery.isLoading}
                  size="sm"
                  className="gap-1.5 gradient-primary border-none shadow-glow text-xs h-8 shrink-0"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save price list
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {priceListQuery.isLoading ? (
                <p className="text-xs text-muted-foreground py-6 text-center">Loading...</p>
              ) : (
                <PriceListTable
                  items={priceRows}
                  editable
                  onChangePrice={updatePrice}
                />
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
    </AdminLayout>
  )
}

function Info({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-xs font-semibold text-primary/70 flex items-center gap-1">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{value}</p>
    </div>
  )
}

function PrefFormCard({ form }: { form: PreferenceFormRecord }) {
  const [expanded, setExpanded] = useState(false)
  const p = form.payload

  const rows: { label: string; value: string; comment?: string }[] = [
    { label: "Occlusion", value: p.occlusion.defaultValues || "—", comment: p.occlusion.comments },
    { label: "Proximal Contacts", value: p.proximalContacts.defaultValues || "—", comment: p.proximalContacts.comments },
    { label: "Distal-most Crown Contact", value: p.distalMostCrownContact.defaultValues || "—", comment: p.distalMostCrownContact.comments },
    { label: "Anatomy", value: p.anatomy.option || "—", comment: p.anatomy.comments },
    { label: "Smile Library", value: [p.smileLibrary.option, p.smileLibrary.libraryName].filter(Boolean).join(" · ") || "—", comment: p.smileLibrary.comments },
    { label: "Pontic Type", value: p.ponticType.option || "—", comment: p.ponticType.comments },
    { label: "Pontic Distance", value: [p.ponticDistanceFromTissue.option, p.ponticDistanceFromTissue.distanceMm ? `${p.ponticDistanceFromTissue.distanceMm}mm` : ""].filter(Boolean).join(" · ") || "—", comment: p.ponticDistanceFromTissue.comments },
    { label: "Match Marginal Ridge", value: p.matchMarginalRidge.option || "—", comment: p.matchMarginalRidge.comments },
  ]

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
        <div className="border-t border-border/50 px-3.5 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rows.map(({ label, value, comment }) => (
            <div key={label} className="rounded border border-border/40 bg-muted/20 px-2.5 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="text-[11px] font-semibold text-foreground mt-0.5">{value}</p>
              {comment && (
                <p className="text-[10px] text-muted-foreground mt-0.5 italic">{comment}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
