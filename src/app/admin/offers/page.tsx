"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent } from "@/src/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { Switch } from "@/src/components/ui/switch"
import { Textarea } from "@/src/components/ui/textarea"
import { clients as clientList } from "@/src/components/demoData"
import { AlertCircle, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import { OFFER_CATEGORIES, type OfferCategory, type OfferClaimRecord, type OfferRecord } from "@/src/lib/offers"

type OffersResponse = { data: OfferRecord[] }
type ClaimsResponse = { data: OfferClaimRecord[] }

type DraftOffer = {
  title: string
  brand: string
  category: OfferCategory | ""
  description: string
  discount: string
  validTill: string
  sponsored: boolean
  targetClients: string[]
  targetLocations: string[]
}

const initialDraft: DraftOffer = {
  title: "",
  brand: "",
  category: "",
  description: "",
  discount: "",
  validTill: "",
  sponsored: false,
  targetClients: [],
  targetLocations: [],
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function draftFromOffer(offer: OfferRecord): DraftOffer {
  return {
    title: offer.title,
    brand: offer.brand,
    category: offer.category,
    description: offer.description,
    discount: offer.discount,
    validTill: offer.validTill,
    sponsored: offer.sponsored,
    targetClients: offer.targetClients,
    targetLocations: offer.targetLocations,
  }
}

export default function AdminOffers() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftOffer>(initialDraft)
  const [offerSearch, setOfferSearch] = useState("")
  const [claimSearch, setClaimSearch] = useState("")

  const offersQuery = useQuery<OffersResponse>({
    queryKey: ["offers"],
    queryFn: async () => {
      const res = await fetch("/api/offers")
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to load offers")
      }
      return json
    },
  })

  const claimsQuery = useQuery<ClaimsResponse>({
    queryKey: ["offer-claims"],
    queryFn: async () => {
      const res = await fetch("/api/offers/claims")
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to load claimed offers")
      }
      return json
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (payload: DraftOffer & { id?: string }) => {
      const isEdit = Boolean(payload.id)
      const res = await fetch(isEdit ? `/api/offers?id=${encodeURIComponent(payload.id!)}` : "/api/offers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || `Failed to ${isEdit ? "update" : "create"} offer`)
      }
      return json as { data: OfferRecord }
    },
    onSuccess: async () => {
      toast.success(editingOfferId ? "Offer updated" : "Offer published")
      setOpen(false)
      setEditingOfferId(null)
      setDraft(initialDraft)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["offers"] }),
        queryClient.invalidateQueries({ queryKey: ["offer-claims"] }),
      ])
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save offer")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/offers?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to delete offer")
      }
      return json
    },
    onSuccess: async () => {
      toast.success("Offer removed")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["offers"] }),
        queryClient.invalidateQueries({ queryKey: ["offer-claims"] }),
      ])
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete offer")
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await fetch(`/api/offers?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to update offer status")
      }
      return json
    },
    onSuccess: () => {
      toast.success("Offer status updated")
      queryClient.invalidateQueries({ queryKey: ["offers"] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update offer status")
    },
  })

  const deliverMutation = useMutation({
    mutationFn: async (claimId: string) => {
      const res = await fetch(`/api/offers/claims?id=${encodeURIComponent(claimId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered" }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to deliver offer")
      }
      return json
    },
    onSuccess: () => {
      toast.success("Offer marked as delivered")
      queryClient.invalidateQueries({ queryKey: ["offer-claims"] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to deliver offer")
    },
  })

  const offers = useMemo(() => {
    const raw = offersQuery.data?.data ?? []
    if (!offerSearch.trim()) return raw
    const q = offerSearch.toLowerCase()
    return raw.filter(
      (o) =>
        o.title.toLowerCase().includes(q) ||
        o.brand.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q)
    )
  }, [offersQuery.data, offerSearch])

  const claims = useMemo(() => {
    const raw = claimsQuery.data?.data ?? []
    if (!claimSearch.trim()) return raw
    const q = claimSearch.toLowerCase()
    return raw.filter(
      (c) =>
        c.offerTitle.toLowerCase().includes(q) ||
        c.offerBrand.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        (c.labName && c.labName.toLowerCase().includes(q))
    )
  }, [claimsQuery.data, claimSearch])

  const submitOffer = async () => {
    if (!draft.title.trim() || !draft.brand.trim()) {
      toast.error("Title and brand are required")
      return
    }
    if (!draft.category) {
      toast.error("Category is required")
      return
    }
    if (!draft.description.trim() || !draft.discount.trim() || !draft.validTill.trim()) {
      toast.error("Description, discount and valid till are required")
      return
    }

    const payload = {
      ...(editingOfferId ? { id: editingOfferId } : {}),
      title: draft.title.trim(),
      brand: draft.brand.trim(),
      category: draft.category,
      description: draft.description.trim(),
      discount: draft.discount.trim(),
      validTill: draft.validTill.trim(),
      sponsored: draft.sponsored,
      targetClients: draft.targetClients,
      targetLocations: draft.targetLocations,
    }

    try {
      await saveMutation.mutateAsync(payload)
    } catch {
      // Handled by mutation onError.
    }
  }

  const remove = async (id: string) => {
    const confirmed = window.confirm("Delete this offer?")
    if (!confirmed) return
    try {
      await deleteMutation.mutateAsync(id)
    } catch {
      // Handled by mutation onError.
    }
  }

  const openCreateDialog = () => {
    setEditingOfferId(null)
    setDraft(initialDraft)
    setOpen(true)
  }

  const openEditDialog = (offer: OfferRecord) => {
    setEditingOfferId(offer.id)
    setDraft(draftFromOffer(offer))
    setOpen(true)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setEditingOfferId(null)
      setDraft(initialDraft)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Offers</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage promotional offers shown to client labs</p>
          </div>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                New Offer
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingOfferId ? "Edit Offer" : "Create Offer"}</DialogTitle>
                <DialogDescription>
                  Update offer details and publish promotional campaigns for client labs.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Brand</Label>
                    <Input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={draft.category}
                      onValueChange={(v) => setDraft({ ...draft, category: v as OfferCategory })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {OFFER_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Discount</Label>
                    <Input
                      placeholder="e.g. 15% off"
                      value={draft.discount}
                      onChange={(e) => setDraft({ ...draft, discount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Valid till</Label>
                    <Input
                      type="date"
                      value={draft.validTill}
                      onChange={(e) => setDraft({ ...draft, validTill: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Target client (optional)</Label>
                    <Select
                      value={draft.targetClients[0] ?? "all"}
                      onValueChange={(v) => setDraft({ ...draft, targetClients: v === "all" ? [] : [v] })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All clients" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All clients</SelectItem>
                        {clientList.map((client) => (
                          <SelectItem key={client.id} value={client.company}>
                            {client.company}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Target location (optional)</Label>
                    <Input
                      placeholder="e.g. Universal"
                      value={draft.targetLocations[0] ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          targetLocations: e.target.value ? [e.target.value] : [],
                        })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Sponsored</p>
                    <p className="text-xs text-muted-foreground">Show a sponsored badge on the client portal card.</p>
                  </div>
                  <Switch
                    checked={draft.sponsored}
                    onCheckedChange={(checked) => setDraft({ ...draft, sponsored: checked })}
                  />
                </div>
                <Button className="w-full gap-2" onClick={submitOffer} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {editingOfferId ? "Update Offer" : "Publish Offer"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex items-center gap-4 bg-card p-4 rounded-lg border border-border/50 shadow-sm max-w-sm">
          <div className="flex-1">
            <Input
              placeholder="Search offers by title or brand..."
              value={offerSearch}
              onChange={(e) => setOfferSearch(e.target.value)}
              className="h-9"
            />
          </div>
        </div>

        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Offer", "Brand", "Category", "Discount", "Targeting", "Valid till", "Active", "Actions"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {offersQuery.isLoading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-4 py-4">
                          <div className="h-4 w-48 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-24 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-28 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-24 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-44 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-20 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-12 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-8 w-16 rounded bg-muted" />
                        </td>
                      </tr>
                    ))
                  ) : offersQuery.error ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        <div className="flex flex-col items-center gap-2 text-red-500">
                          <AlertCircle className="h-8 w-8" />
                          <p>{(offersQuery.error as Error).message}</p>
                        </div>
                      </td>
                    </tr>
                  ) : offers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        {offerSearch ? "No offers match your search." : "No offers published yet."}
                      </td>
                    </tr>
                  ) : (
                    offers.map((offer) => (
                      <tr key={offer.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{offer.title}</span>
                            {offer.sponsored && (
                              <Badge className="gap-1 bg-warning text-warning-foreground">
                                <Sparkles className="h-3 w-3" />
                                Sponsored
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-1">{offer.description}</p>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{offer.brand}</td>
                        <td className="px-4 py-4 text-muted-foreground">{offer.category}</td>
                        <td className="px-4 py-4 text-primary font-medium">{offer.discount}</td>
                        <td className="px-4 py-4 text-xs text-muted-foreground">
                          {offer.targetClients.length ? `Client: ${offer.targetClients.join(", ")}` : "All clients"}
                          {offer.targetLocations.length ? ` | ${offer.targetLocations.join(", ")}` : ""}
                        </td>
                        <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">
                          {formatDate(offer.validTill)}
                        </td>
                        <td className="px-4 py-4">
                          <Switch
                            checked={offer.active !== false}
                            onCheckedChange={(checked) =>
                              toggleActiveMutation.mutate({ id: offer.id, active: checked })
                            }
                            disabled={toggleActiveMutation.isPending}
                          />
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(offer)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => remove(offer.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="border-b border-border/60 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Claimed Offers</h2>
                <p className="text-sm text-muted-foreground">Client details are shown here when an offer is claimed.</p>
              </div>
              <div className="w-full sm:w-72">
                <Input
                  placeholder="Search claims by lab, client, offer..."
                  value={claimSearch}
                  onChange={(e) => setClaimSearch(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Offer", "Client name", "Lab name", "Email", "Phone", "Claimed at", "Status", "Actions"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {claimsQuery.isLoading ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-4 py-4">
                          <div className="h-4 w-40 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-32 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-36 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-44 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-28 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-28 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-16 rounded bg-muted" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-8 w-16 rounded bg-muted" />
                        </td>
                      </tr>
                    ))
                  ) : claimsQuery.error ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        <div className="flex flex-col items-center gap-2 text-red-500">
                          <AlertCircle className="h-8 w-8" />
                          <p>{(claimsQuery.error as Error).message}</p>
                        </div>
                      </td>
                    </tr>
                  ) : claims.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        {claimSearch ? "No claimed offers match your search." : "No offers have been claimed yet."}
                      </td>
                    </tr>
                  ) : (
                    claims.map((claim) => (
                      <tr key={claim.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{claim.offerTitle}</span>
                            <Badge variant="secondary" className="text-xs">
                              {claim.offerBrand}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{claim.offerDiscount}</p>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{claim.clientName}</td>
                        <td className="px-4 py-4 text-muted-foreground">{claim.labName}</td>
                        <td className="px-4 py-4 text-muted-foreground">{claim.email}</td>
                        <td className="px-4 py-4 text-muted-foreground">{claim.phone}</td>
                        <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">
                          {formatDate(claim.claimedAt)}
                        </td>
                        <td className="px-4 py-4">
                          <Badge
                            variant={claim.status === "delivered" ? "default" : "secondary"}
                            className={
                              claim.status === "delivered"
                                ? "bg-emerald-500 hover:bg-emerald-600 text-white border-0"
                                : "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-0"
                            }
                          >
                            {claim.status === "delivered" ? "Delivered" : "Claimed"}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">
                          {claim.status !== "delivered" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-600 text-emerald-500"
                              onClick={() => deliverMutation.mutate(claim.id)}
                              disabled={deliverMutation.isPending}
                            >
                              {deliverMutation.isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Deliver"
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  )
}
