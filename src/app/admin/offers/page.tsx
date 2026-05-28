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
import { AlertCircle, Loader2, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react"
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
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="space-y-0.5">
            <h1 className="text-lg font-semibold text-foreground">Offers</h1>
            <p className="text-xs text-muted-foreground">Manage promotional offers shown to client labs</p>
          </div>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5 text-xs h-8" onClick={openCreateDialog}>
                <Plus className="h-3.5 w-3.5" />
                New Offer
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl text-xs">
              <DialogHeader>
                <DialogTitle className="text-sm font-semibold ">{editingOfferId ? "Edit Offer" : "Create Offer"}</DialogTitle>
                <DialogDescription className="text-xs">
                  Update offer details and publish promotional campaigns for client labs.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3.5 mt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Title</Label>
                  <Input className="h-8 text-xs" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Brand</Label>
                    <Input className="h-8 text-xs" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select
                      value={draft.category}
                      onValueChange={(v) => setDraft({ ...draft, category: v as OfferCategory })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {OFFER_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category} className="text-xs">
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Textarea
                    rows={4}
                    className="text-xs"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Discount</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. 15% off"
                      value={draft.discount}
                      onChange={(e) => setDraft({ ...draft, discount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valid till</Label>
                    <Input
                      className="h-8 text-xs"
                      type="date"
                      value={draft.validTill}
                      onChange={(e) => setDraft({ ...draft, validTill: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Target client (optional)</Label>
                    <Select
                      value={draft.targetClients[0] ?? "all"}
                      onValueChange={(v) => setDraft({ ...draft, targetClients: v === "all" ? [] : [v] })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="All clients" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">All clients</SelectItem>
                        {clientList.map((client) => (
                          <SelectItem key={client.id} value={client.company} className="text-xs">
                            {client.company}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Target location (optional)</Label>
                    <Input
                      className="h-8 text-xs"
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
                <div className="flex items-center justify-between rounded border border-border/60 px-3.5 py-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Sponsored</p>
                    <p className="text-[10px] text-muted-foreground">Show a sponsored badge on the client portal card.</p>
                  </div>
                  <Switch
                    className="scale-75 origin-right"
                    checked={draft.sponsored}
                    onCheckedChange={(checked) => setDraft({ ...draft, sponsored: checked })}
                  />
                </div>
                <Button className="w-full h-8 text-xs gap-1.5" onClick={submitOffer} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {editingOfferId ? "Update Offer" : "Publish Offer"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex items-center bg-card rounded-lg border border-border/50 shadow-sm max-w-xs">
          <Search className="w-4 h-4 ml-2 text-muted-foreground"/>
          <div className="flex-1">
            <Input
              placeholder="Search offers by title or brand..."
              value={offerSearch}
              onChange={(e) => setOfferSearch(e.target.value)}
              className="h-8 text-xs border-none bg-muted/30"
            />
          </div>
        </div>

        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Offer", "Brand", "Category", "Discount", "Targeting", "Valid till", "Active", "Actions"].map((h) => (
                      <th key={h} className="px-3.5 py-2 text-left text-xs font-semibold text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {offersQuery.isLoading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-36 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-16 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-20 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-16 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-28 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-16 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-8 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-6 w-12 bg-muted rounded" />
                        </td>
                      </tr>
                    ))
                  ) : offersQuery.error ? (
                    <tr>
                      <td colSpan={8} className="px-3.5 py-8 text-center">
                        <div className="flex flex-col items-center gap-1.5 text-red-500">
                          <AlertCircle className="h-6 w-6" />
                          <p>{(offersQuery.error as Error).message}</p>
                        </div>
                      </td>
                    </tr>
                  ) : offers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3.5 py-8 text-center text-xs text-muted-foreground">
                        {offerSearch ? "No offers match your search." : "No offers published yet."}
                      </td>
                    </tr>
                  ) : (
                    offers.map((offer) => (
                      <tr key={offer.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-3.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold  text-[11px] text-slate-800">{offer.title}</span>
                            {offer.sponsored && (
                              <Badge className="gap-0.5 bg-warning text-warning-foreground text-[9px] px-1 py-0 border-0 scale-90 origin-left">
                                <Sparkles className="h-2.5 w-2.5" />
                                Sponsored
                              </Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{offer.description}</p>
                        </td>
                        <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{offer.brand}</td>
                        <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{offer.category}</td>
                        <td className="px-3.5 py-2 text-primary text-[11px] font-semibold ">{offer.discount}</td>
                        <td className="px-3.5 py-2 text-[10px] text-muted-foreground">
                          {offer.targetClients.length ? `Client: ${offer.targetClients.join(", ")}` : "All clients"}
                          {offer.targetLocations.length ? ` | ${offer.targetLocations.join(", ")}` : ""}
                        </td>
                        <td className="px-3.5 py-2 text-[10px] text-muted-foreground whitespace-nowrap">
                          {formatDate(offer.validTill)}
                        </td>
                        <td className="px-3.5 py-2">
                          <Switch
                            className="scale-75 origin-left"
                            checked={offer.active !== false}
                            onCheckedChange={(checked) =>
                              toggleActiveMutation.mutate({ id: offer.id, active: checked })
                            }
                            disabled={toggleActiveMutation.isPending}
                          />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="flex gap-0.5">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditDialog(offer)}>
                              <Pencil className="h-3.5 w-3.5 text-slate-700" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => remove(offer.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
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

        <Card className="shadow-card border-border/50 overflow-hidden mt-12">
          <CardContent className="p-0">
            <div className="border-b border-border/60 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 pb-2 bg-muted/10">
              <div className="space-y-0.5">
                <h2 className="text-xs font-semibold  text-foreground">Claimed Offers</h2>
                <p className="text-[10px] text-muted-foreground">Client details are shown here when an offer is claimed.</p>
              </div>
              <div className="w-full sm:w-60">
                <Input
                  placeholder="Search claims by lab, client, offer..."
                  value={claimSearch}
                  onChange={(e) => setClaimSearch(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Offer", "Name", "Lab name", "Email", "Phone", "Claimed on", "Status", "Actions"].map((h) => (
                      <th key={h} className="px-3.5 py-2 text-left text-xs font-semibold text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {claimsQuery.isLoading ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-32 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-24 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-28 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-32 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-20 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-20 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-3.5 w-12 bg-muted rounded" />
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="h-6 w-12 bg-muted rounded" />
                        </td>
                      </tr>
                    ))
                  ) : claimsQuery.error ? (
                    <tr>
                      <td colSpan={8} className="px-3.5 py-8 text-center">
                        <div className="flex flex-col items-center gap-1.5 text-red-500">
                          <AlertCircle className="h-6 w-6" />
                          <p>{(claimsQuery.error as Error).message}</p>
                        </div>
                      </td>
                    </tr>
                  ) : claims.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3.5 py-8 text-center text-xs text-muted-foreground">
                        {claimSearch ? "No claimed offers match your search." : "No offers have been claimed yet."}
                      </td>
                    </tr>
                  ) : (
                    claims.map((claim) => (
                      <tr key={claim.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-3.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold  text-[11px] text-slate-800">{claim.offerTitle}</span>
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 font-semibold text-slate-700">
                              {claim.offerBrand}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{claim.offerDiscount}</p>
                        </td>
                        <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{claim.clientName}</td>
                        <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{claim.labName}</td>
                        <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{claim.email}</td>
                        <td className="px-3.5 py-2 text-[11px] text-muted-foreground">{claim.phone}</td>
                        <td className="px-3.5 py-2 text-[10px] text-muted-foreground whitespace-nowrap">
                          {formatDate(claim.claimedAt)}
                        </td>
                        <td className="px-3.5 py-2">
                          <span
                            className={
                              claim.status === "delivered"
                                ? "text-emerald-500 text-[10px] font-semibold"
                                : "text-amber-500 text-[10px] font-semibold "
                            }
                          >
                            {claim.status === "delivered" ? "Delivered" : "Claimed"}
                          </span>
                        </td>
                        <td className="px-3.5 py-2">
                          {claim.status !== "delivered" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[10px] gap-1 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-600 text-emerald-500 font-semibold "
                              onClick={() => deliverMutation.mutate(claim.id)}
                              disabled={deliverMutation.isPending}
                            >
                              {deliverMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Deliver"
                              )}
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
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
