"use client"

import { ReactNode, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AppLayout } from "@/src/components/AppLayout"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent } from "@/src/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { ExternalLink, Loader2, Sparkles, Tag, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { OFFER_CATEGORIES, type OfferClaimRecord, type OfferRecord } from "@/src/lib/offers"
import { Camera, BrickWall, Wrench, Code, FlaskConical } from "lucide-react"

type OffersResponse = { data: OfferRecord[] }
type ClaimsResponse = { data: OfferClaimRecord[] }

const categories: (typeof OFFER_CATEGORIES[number] | "All")[] = ["All", ...OFFER_CATEGORIES]

const categoryEmoji: Record<OfferRecord["category"], ReactNode> = {
  "Intraoral Scanner": <Camera className="w-14 h-14" />,
  Materials: <BrickWall className="w-14 h-14" />,
  Equipment: <Wrench className="w-14 h-14" />,
  Software: <Code className="w-14 h-14" />,
  Consumables: <FlaskConical className="w-14 h-14" />,
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
  const claimedOfferIds = useMemo(() => {
    return new Set((claimsQuery.data?.data ?? []).map((claim) => claim.offerId))
  }, [claimsQuery.data])

  const list = useMemo(() => {
    return filter === "All" ? offers : offers.filter((offer) => offer.category === filter)
  }, [filter, offers])

  const handleClaim = async (offer: OfferRecord) => {
    setSelectedOffer(offer)
    try {
      await claimMutation.mutateAsync(offer.id)
    } catch {
      // Handled by mutation onError.
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Partner Offers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Exclusive deals curated by Iconic Dental for our partner labs
          </p>
        </div>

        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <Button
                  key={category}
                  type="button"
                  variant={filter === category ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(category)}
                >
                  {category}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {offersQuery.isLoading || claimsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="overflow-hidden shadow-card">
                <div className="h-32 animate-pulse bg-muted" />
                <CardContent className="space-y-3 p-5">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                  <div className="h-10 w-full animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : offersQuery.error ? (
          <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20">
            <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <AlertCircle className="h-10 w-10 text-red-500" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">Failed to load offers</h3>
              <p className="mt-1 text-sm text-muted-foreground">{(offersQuery.error as Error).message}</p>
              <Button className="mt-4" variant="outline" onClick={() => offersQuery.refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : list.length === 0 ? (
          <Card className="border-dashed border-border/60">
            <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Tag className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">
                {filter === "All" ? "No offers available yet" : "No offers match this category"}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {filter === "All"
                  ? "Check back after the team publishes new partner offers."
                  : "Choose another category to see more offers."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {list.map((offer) => {
              const claimed = claimedOfferIds.has(offer.id)

              return (
                <Card
                  key={offer.id}
                  className="overflow-hidden border-border/60 shadow-card transition-shadow hover:shadow-elevated"
                >
                  <div className="relative flex h-32 items-center justify-center bg-linear-to-br from-muted to-background text-5xl">
                    {categoryEmoji[offer.category]}
                    {offer.sponsored && (
                      <Badge className="absolute right-3 top-3 gap-1 bg-warning text-warning-foreground">
                        <Sparkles className="h-3 w-3" />
                        Sponsored
                      </Badge>
                    )}
                  </div>
                  <CardContent className="space-y-3 p-5">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        {offer.brand} | {offer.category}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-foreground">{offer.title}</h3>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{offer.description}</p>
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                        <Tag className="h-3.5 w-3.5" />
                        {offer.discount}
                      </span>
                      <span className="text-xs text-muted-foreground">Valid till {formatDate(offer.validTill)}</span>
                    </div>
                    <Button
                      className="w-full"
                      variant={claimed ? "secondary" : "outline"}
                      disabled={claimed || claimMutation.isPending}
                      onClick={() => handleClaim(offer)}
                    >
                      {claimMutation.isPending && selectedOffer?.id === offer.id ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : claimed ? (
                        "Claimed"
                      ) : (
                        <>
                          Claim Offer <ExternalLink className="ml-2 h-3.5 w-3.5" />
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
          <p className="text-sm text-muted-foreground">
            {selectedOffer ? `Submitting your claim for ${selectedOffer.title}.` : "Submitting your claim."}
          </p>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
