"use client"

import { ReactNode, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClientLayout } from "@/src/components/ClientLayout"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent } from "@/src/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { Input } from "@/src/components/ui/input"
import { ExternalLink, Loader2, Sparkles, Tag, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { OFFER_CATEGORIES, type OfferClaimRecord, type OfferRecord } from "@/src/lib/offers"
import { Camera, BrickWall, Wrench, Code, FlaskConical } from "lucide-react"

type OffersResponse = { data: OfferRecord[] }
type ClaimsResponse = { data: OfferClaimRecord[] }

const categories: (typeof OFFER_CATEGORIES[number] | "All")[] = ["All", ...OFFER_CATEGORIES]

const categoryEmoji: Record<OfferRecord["category"], ReactNode> = {
  "Intraoral Scanner": <Camera className="w-10 h-10" />,
  Materials: <BrickWall className="w-10 h-10" />,
  Equipment: <Wrench className="w-10 h-10" />,
  Software: <Code className="w-10 h-10" />,
  Consumables: <FlaskConical className="w-10 h-10" />,
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default function Offers() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<(typeof categories)[number]>("All")
  const [search, setSearch] = useState("")
  const [selectedOffer, setSelectedOffer] = useState<OfferRecord | null>(null)

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
    queryKey: ["offer-claims", "mine"],
    queryFn: async () => {
      const res = await fetch("/api/offers/claims")
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to load claimed offers")
      }
      return json
    },
  })

  const claimMutation = useMutation({
    mutationFn: async (offerId: string) => {
      const res = await fetch("/api/offers/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to claim offer")
      }
      return json as { data: OfferClaimRecord }
    },
    onSuccess: async () => {
      toast.success("Offer claimed")
      setSelectedOffer(null)
      await queryClient.invalidateQueries({ queryKey: ["offer-claims", "mine"] })
    },
    onError: (error) => {
      setSelectedOffer(null)
      toast.error(error instanceof Error ? error.message : "Failed to claim offer")
    },
  })

  const offers = useMemo(() => offersQuery.data?.data ?? [], [offersQuery.data])

  const claimsByOfferId = useMemo(() => {
    const map = new Map<string, OfferClaimRecord>()
    for (const claim of (claimsQuery.data?.data ?? [])) {
      map.set(claim.offerId, claim)
    }
    return map
  }, [claimsQuery.data])

  const list = useMemo(() => {
    let filtered = filter === "All" ? offers : offers.filter((offer) => offer.category === filter)
    if (!search.trim()) return filtered
    const q = search.toLowerCase()
    return filtered.filter(
      (offer) =>
        offer.title.toLowerCase().includes(q) ||
        offer.brand.toLowerCase().includes(q) ||
        offer.description.toLowerCase().includes(q)
    )
  }, [filter, offers, search])

  const handleClaim = async (offer: OfferRecord) => {
    setSelectedOffer(offer)
    try {
      await claimMutation.mutateAsync(offer.id)
    } catch {
      // Handled by mutation onError.
    }
  }

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Partner Offers</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Exclusive deals curated by Iconic Dental for our partner labs
          </p>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-card p-3 rounded border border-border/50 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((category) => (
              <Button
                key={category}
                type="button"
                variant={filter === category ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setFilter(category)}
              >
                {category}
              </Button>
            ))}
          </div>
          <div className="w-full md:w-64">
            <Input
              placeholder="Search by title, brand..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        </div>

        {offersQuery.isLoading || claimsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="overflow-hidden shadow-card border-border/50">
                <div className="h-24 animate-pulse bg-muted" />
                <CardContent className="space-y-2.5 p-3.5">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                  <div className="h-8 w-full animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : offersQuery.error ? (
          <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20">
            <CardContent className="flex flex-col items-center justify-center px-4 py-8 text-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <h3 className="mt-2 text-xs font-semibold text-foreground">Failed to load offers</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">{(offersQuery.error as Error).message}</p>
              <Button className="mt-3 h-8 text-xs" variant="outline" onClick={() => offersQuery.refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : list.length === 0 ? (
          <Card className="border-dashed border-border/60">
            <CardContent className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <Tag className="h-8 w-8 text-muted-foreground" />
              <h3 className="mt-2 text-xs font-semibold text-foreground">
                {search ? "No offers match your search." : filter === "All" ? "No offers available yet" : "No offers match this category"}
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {search ? "Try searching for a different keyword." : filter === "All"
                  ? "Check back after the team publishes new partner offers."
                  : "Choose another category to see more offers."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {list.map((offer) => {
              const claimRecord = claimsByOfferId.get(offer.id)
              const claimed = Boolean(claimRecord)
              const delivered = claimRecord?.status === "delivered"

              return (
                <Card
                  key={offer.id}
                  className="overflow-hidden border border-border/50 shadow-card transition-shadow hover:shadow-elevated"
                >
                  <div className="relative flex h-24 items-center justify-center bg-linear-to-br from-muted to-background text-3xl">
                    {categoryEmoji[offer.category]}
                    {offer.sponsored && (
                      <Badge className="absolute right-2 top-2 gap-1 bg-amber-500 text-white hover:bg-amber-600 scale-90 origin-right text-[10px] font-semibold py-0.5 px-1.5">
                        <Sparkles className="h-2.5 w-2.5" />
                        Sponsored
                      </Badge>
                    )}
                  </div>
                  <CardContent className="space-y-2.5 p-3.5">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {offer.brand} | {offer.category}
                      </p>
                      <h3 className="mt-0.5 text-xs font-semibold text-foreground leading-snug">{offer.title}</h3>
                    </div>
                    <p className="line-clamp-2 text-[11px] text-muted-foreground leading-normal">{offer.description}</p>
                    <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
                        <Tag className="h-3 w-3" />
                        {offer.discount}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Valid till {formatDate(offer.validTill)}</span>
                    </div>
                    <Button
                      className="w-full h-8 text-xs font-semibold"
                      variant={claimed ? "secondary" : "outline"}
                      disabled={claimed || claimMutation.isPending}
                      onClick={() => handleClaim(offer)}
                    >
                      {claimMutation.isPending && selectedOffer?.id === offer.id ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : delivered ? (
                        "Delivered"
                      ) : claimed ? (
                        "Claimed"
                      ) : (
                        <>
                          Claim Offer <ExternalLink className="ml-1.5 h-3 w-3" />
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(selectedOffer) && claimMutation.isPending}
        onOpenChange={(nextOpen) => !nextOpen && setSelectedOffer(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Processing claim</DialogTitle>
            <DialogDescription>Submitting your offer claim and saving it for the admin dashboard.</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {selectedOffer ? `Submitting your claim for ${selectedOffer.title}.` : "Submitting your claim."}
          </p>
        </DialogContent>
      </Dialog>
    </ClientLayout>
  )
}
