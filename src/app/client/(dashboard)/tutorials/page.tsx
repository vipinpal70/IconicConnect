"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Image from "next/image"
import { ClientLayout } from "@/src/components/ClientLayout"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent } from "@/src/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { Input } from "@/src/components/ui/input"
import {
  AlertCircle,
  Clock3,
  PlayCircle,
  Search,
  Video,
} from "lucide-react"
import {
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
  TUTORIAL_CATEGORIES,
  type TutorialRecord,
} from "@/src/lib/tutorials"

type TutorialsResponse = { data: TutorialRecord[] }

const categories = ["All", ...TUTORIAL_CATEGORIES] as const

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function TutorialCard({
  tutorial,
  onOpen,
}: {
  tutorial: TutorialRecord
  onOpen: (tutorial: TutorialRecord) => void
}) {
  const thumbnailUrl = getYouTubeThumbnailUrl(tutorial.youtubeVideoId)

  return (
    <Card className="group overflow-hidden border-border/60 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated">
      <button type="button" onClick={() => onOpen(tutorial)} className="block w-full text-left">
        <div className="relative aspect-video overflow-hidden bg-muted">
          <Image
            src={thumbnailUrl}
            alt={tutorial.title}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/30 transition-transform group-hover:scale-105">
              <PlayCircle className="h-8 w-8 text-white drop-shadow" />
            </div>
          </div>
          <div className="absolute left-3 top-3 flex gap-2">
            <Badge className="border-white/20 bg-black/35 text-white">YouTube</Badge>
          </div>
          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            <Clock3 className="h-3 w-3" />
            {formatDate(tutorial.createdAt)}
          </div>
        </div>
      </button>
      <CardContent className="space-y-3 p-4">
        <div>
          <Badge variant="secondary" className="mb-2 text-[10px] font-medium uppercase tracking-wider">
            {tutorial.category}
          </Badge>
          <h3 className="line-clamp-1 text-sm font-semibold text-foreground">{tutorial.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tutorial.description}</p>
        </div>
        <p className="break-all text-[11px] text-muted-foreground">{tutorial.youtubeVideoId}</p>
      </CardContent>
    </Card>
  )
}

export default function ClientTutorialsPage() {
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<(typeof categories)[number]>("All")
  const [activeTutorial, setActiveTutorial] = useState<TutorialRecord | null>(null)

  const tutorialsQuery = useQuery<TutorialsResponse>({
    queryKey: ["tutorials"],
    queryFn: async () => {
      const res = await fetch("/api/tutorials")
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to load tutorials")
      }
      return json
    },
  })

  const tutorials = useMemo(() => tutorialsQuery.data?.data ?? [], [tutorialsQuery.data])

  const filteredTutorials = useMemo(() => {
    const term = search.trim().toLowerCase()
    return tutorials.filter((tutorial) => {
      const matchesCategory = categoryFilter === "All" || tutorial.category === categoryFilter
      const matchesSearch = !term || (
        tutorial.title.toLowerCase().includes(term) ||
        tutorial.description.toLowerCase().includes(term) ||
        tutorial.youtubeVideoId.toLowerCase().includes(term)
      )

      return matchesCategory && matchesSearch
    })
  }, [search, tutorials, categoryFilter])

  return (
    <ClientLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Tutorials</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Browse and play every tutorial published by the team.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
            <Video className="h-4 w-4 text-red-500" />
            {filteredTutorials.length} available
          </div>
        </div>

        {/* <Card className="shadow-card border-border/60 rounded-lg"> */}
          <div className="flex md:flex-row md:items-center justify-between gap-3 bg-card p-2 rounded border border-border/50 shadow-sm mb-4">
            <div className="flex justify-between gap-4">

              {/* filter btn */}
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    size="sm"
                    className="h-7 text-xs px-2.5"
                    variant={categoryFilter === category ? "default" : "outline"}
                    onClick={() => setCategoryFilter(category)}
                  >
                    {category}
                  </Button>
                ))}
              </div>

            </div>
            {/* search bar */}
              <div className="relative max-w-md flex">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 text-xs"
                  placeholder="Search tutorials"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
          </div>

        {/* </Card> */}

        {tutorialsQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="overflow-hidden rounded-xl border border-border/60">
                <div className="aspect-video animate-pulse bg-muted" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : tutorialsQuery.error ? (
          <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20">
            <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <AlertCircle className="h-10 w-10 text-red-500" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">Failed to load tutorials</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {(tutorialsQuery.error as Error).message}
              </p>
              <Button className="mt-4" variant="outline" onClick={() => tutorialsQuery.refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : filteredTutorials.length === 0 ? (
          <Card className="border-dashed border-border/60">
            <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Video className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">
                {search || categoryFilter !== "All" ? "No tutorials match your filters" : "No tutorials available yet"}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {search || categoryFilter !== "All"
                  ? "Try a different title, description, video ID, or category."
                  : "Check back after the admin team publishes new tutorials."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTutorials.map((tutorial) => (
              <TutorialCard key={tutorial.id} tutorial={tutorial} onOpen={setActiveTutorial} />
            ))}
          </div>
        )}

        <Dialog open={Boolean(activeTutorial)} onOpenChange={(open) => !open && setActiveTutorial(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{activeTutorial?.title}</DialogTitle>
            </DialogHeader>
            {activeTutorial && (
              <div className="space-y-4">
                <div className="aspect-video overflow-hidden rounded-xl bg-black">
                  <iframe
                    className="h-full w-full"
                    src={getYouTubeEmbedUrl(activeTutorial.youtubeVideoId)}
                    title={activeTutorial.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{activeTutorial.description}</p>
                  <p className="text-xs text-muted-foreground">Published {formatDate(activeTutorial.createdAt)}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ClientLayout>
  )
}
