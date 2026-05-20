"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Image from "next/image"
import { toast } from "sonner"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import {
  AlertCircle,
  Clock3,
  Loader2,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  Video,
} from "lucide-react"
import {
  extractYouTubeVideoId,
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
  isTutorialCategory,
  TUTORIAL_CATEGORIES,
  type TutorialCategory,
  type TutorialRecord,
} from "@/src/lib/tutorials"

type TutorialsResponse = { data: TutorialRecord[] }

type FormState = {
  title: string
  description: string
  category: TutorialCategory | ""
  youtubeVideoId: string
}

type FormErrors = Partial<Record<keyof FormState, string>>

const initialFormState: FormState = {
  title: "",
  description: "",
  category: "",
  youtubeVideoId: "",
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function validateForm(form: FormState) {
  const nextErrors: FormErrors = {}
  const title = form.title.trim()
  const description = form.description.trim()
  const category = form.category.trim()
  const videoId = extractYouTubeVideoId(form.youtubeVideoId)

  if (!title) nextErrors.title = "Title is required."
  if (title.length > 200) nextErrors.title = "Title must be 200 characters or fewer."
  if (!description) nextErrors.description = "Description is required."
  if (!isTutorialCategory(category)) nextErrors.category = "Choose a category."
  if (!videoId) nextErrors.youtubeVideoId = "Enter a valid 11-character YouTube video ID."

  return { nextErrors, videoId }
}

function TutorialCard({
  tutorial,
  onPreview,
  onDelete,
  deleting,
}: {
  tutorial: TutorialRecord
  onPreview: (tutorial: TutorialRecord) => void
  onDelete: (tutorial: TutorialRecord) => void
  deleting: boolean
}) {
  const thumbnailUrl = getYouTubeThumbnailUrl(tutorial.youtubeVideoId)

  return (
    <Card className="group overflow-hidden border-border/60 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated">
      <button type="button" onClick={() => onPreview(tutorial)} className="block w-full text-left">
        <div className="relative aspect-video overflow-hidden bg-muted">
          <Image
            src={thumbnailUrl}
            alt={tutorial.title}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-linear-to-t from-black/65 via-black/20 to-transparent" />
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
      <CardContent className="space-y-4 p-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge variant="secondary" className="mb-2 text-[10px] font-medium uppercase tracking-wider">
                {tutorial.category}
              </Badge>
              <h3 className="line-clamp-1 text-sm font-semibold text-foreground">{tutorial.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tutorial.description}</p>
            </div>
          </div>
          <p className="break-all text-[11px] text-muted-foreground">{tutorial.youtubeVideoId}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => onPreview(tutorial)}>
            <PlayCircle className="h-4 w-4" />
            Preview
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={() => onDelete(tutorial)}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AdminTutorialsPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(initialFormState)
  const [errors, setErrors] = useState<FormErrors>({})
  const [search, setSearch] = useState("")
  const [previewTutorial, setPreviewTutorial] = useState<TutorialRecord | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  const createMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const res = await fetch("/api/tutorials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to create tutorial")
      }
      return json as { data: TutorialRecord }
    },
    onSuccess: async () => {
      toast.success("Tutorial published")
      setForm(initialFormState)
      setErrors({})
      await queryClient.invalidateQueries({ queryKey: ["tutorials"] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create tutorial")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tutorials?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || "Failed to delete tutorial")
      }
      return json
    },
    onMutate: (id) => setDeletingId(id),
    onSettled: () => setDeletingId(null),
    onSuccess: async () => {
      toast.success("Tutorial deleted")
      await queryClient.invalidateQueries({ queryKey: ["tutorials"] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete tutorial")
    },
  })

  const tutorials = useMemo(() => tutorialsQuery.data?.data ?? [], [tutorialsQuery.data])
  const filteredTutorials = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return tutorials

    return tutorials.filter((tutorial) => {
      return (
        tutorial.title.toLowerCase().includes(term) ||
        tutorial.description.toLowerCase().includes(term) ||
        tutorial.youtubeVideoId.toLowerCase().includes(term)
      )
    })
  }, [search, tutorials])

  const liveVideoId = extractYouTubeVideoId(form.youtubeVideoId)
  const livePreviewUrl = liveVideoId ? getYouTubeEmbedUrl(liveVideoId) : null

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validation = validateForm(form)
    setErrors(validation.nextErrors)

    if (Object.keys(validation.nextErrors).length > 0 || !validation.videoId) {
      return
    }

    try {
      await createMutation.mutateAsync({
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        youtubeVideoId: validation.videoId,
      })
    } catch {
      // toast is handled in the mutation error callback
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Tutorials</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload tutorials, preview them live, and manage what the client portal shows.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
            <Video className="h-4 w-4 text-red-500" />
            {tutorials.length} published
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Card className="shadow-card border-border/60">
            <CardHeader className="space-y-1 border-b border-border/60">
              <CardTitle className="text-base">Add Tutorial</CardTitle>
              <p className="text-sm text-muted-foreground">Paste a YouTube video ID and publish it to both portals.</p>
            </CardHeader>
            <CardContent className="p-5">
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="tutorial-category">Category</Label>
                  <select
                    id="tutorial-category"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={form.category}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, category: event.target.value as TutorialCategory | "" }))
                      if (errors.category) setErrors((current) => ({ ...current, category: undefined }))
                    }}
                  >
                    <option value="">Select a category</option>
                    {TUTORIAL_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  {errors.category && <p className="text-xs text-red-500">{errors.category}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tutorial-title">Title</Label>
                  <Input
                    id="tutorial-title"
                    placeholder="e.g. Getting started with Iconic Connect"
                    value={form.title}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, title: event.target.value }))
                      if (errors.title) setErrors((current) => ({ ...current, title: undefined }))
                    }}
                  />
                  {errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tutorial-video-id">YouTube Video ID</Label>
                  <Input
                    id="tutorial-video-id"
                    placeholder="dQw4w9WgXcQ"
                    value={form.youtubeVideoId}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, youtubeVideoId: event.target.value }))
                      if (errors.youtubeVideoId) setErrors((current) => ({ ...current, youtubeVideoId: undefined }))
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the 11-character ID from YouTube. A full URL also works if it contains a valid ID.
                  </p>
                  {errors.youtubeVideoId && <p className="text-xs text-red-500">{errors.youtubeVideoId}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tutorial-description">Description</Label>
                  <Textarea
                    id="tutorial-description"
                    rows={5}
                    placeholder="Explain what the tutorial covers and what users will learn."
                    value={form.description}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, description: event.target.value }))
                      if (errors.description) setErrors((current) => ({ ...current, description: undefined }))
                    }}
                  />
                  {errors.description && <p className="text-xs text-red-500">{errors.description}</p>}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {liveVideoId ? "Live preview is ready." : "Preview appears automatically after a valid video ID is entered."}
                  </div>
                  <Button
                    type="submit"
                    className="gap-2 border-none bg-primary shadow-glow"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Publish Tutorial
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/60 overflow-hidden">
            <CardHeader className="space-y-1 border-b border-border/60">
              <CardTitle className="text-base">Live Preview</CardTitle>
              <p className="text-sm text-muted-foreground">This is the exact embedded player users will see.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="aspect-video bg-black">
                {livePreviewUrl ? (
                  <iframe
                    className="h-full w-full"
                    src={livePreviewUrl}
                    title="YouTube preview"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-linear-to-br from-muted via-background to-muted px-6 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Video className="h-8 w-8" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">No preview yet</p>
                      <p className="text-sm text-muted-foreground">
                        Add a valid YouTube video ID to render the embed here.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid gap-3 border-t border-border/60 p-5 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Title</p>
                  <p className="mt-1 text-sm text-foreground">{form.title.trim() || "Untitled tutorial"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Video ID</p>
                  <p className="mt-1 break-all text-sm text-foreground">{liveVideoId || "Waiting for a valid ID"}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Description</p>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                    {form.description.trim() || "Add a description to help clients understand the tutorial."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/60">
          <CardHeader className="gap-4 border-b border-border/60 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Uploaded Tutorials</CardTitle>
              <p className="text-sm text-muted-foreground">Delete or preview any tutorial at any time.</p>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search tutorials"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {tutorialsQuery.isLoading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="overflow-hidden rounded-xl border border-border/60">
                    <div className="aspect-video animate-pulse bg-muted" />
                    <div className="space-y-3 p-4">
                      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-full animate-pulse rounded bg-muted" />
                      <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                      <div className="flex justify-between gap-3 pt-1">
                        <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
                        <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : tutorialsQuery.error ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-red-200 bg-red-50 px-6 py-12 text-center dark:border-red-900/60 dark:bg-red-950/20">
                <AlertCircle className="h-10 w-10 text-red-500" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">Failed to load tutorials</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(tutorialsQuery.error as Error).message}
                </p>
                <Button className="mt-4" variant="outline" onClick={() => tutorialsQuery.refetch()}>
                  Try again
                </Button>
              </div>
            ) : filteredTutorials.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
                <Video className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">
                  {search ? "No tutorials match your search" : "No tutorials uploaded yet"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {search
                    ? "Try a different title, description, or video ID."
                    : "Use the form above to publish the first tutorial."}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredTutorials.map((tutorial) => (
                  <TutorialCard
                    key={tutorial.id}
                    tutorial={tutorial}
                    deleting={deletingId === tutorial.id && deleteMutation.isPending}
                    onPreview={setPreviewTutorial}
                    onDelete={(item) => {
                      const confirmed = window.confirm(`Delete "${item.title}"?`)
                      if (!confirmed) return
                      deleteMutation.mutate(item.id)
                    }}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(previewTutorial)} onOpenChange={(open) => !open && setPreviewTutorial(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{previewTutorial?.title}</DialogTitle>
            </DialogHeader>
            {previewTutorial && (
              <div className="space-y-4">
                <div className="aspect-video overflow-hidden rounded-xl bg-black">
                  <iframe
                    className="h-full w-full"
                    src={getYouTubeEmbedUrl(previewTutorial.youtubeVideoId)}
                    title={previewTutorial.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{previewTutorial.description}</p>
                  <p className="text-xs text-muted-foreground">Video ID: {previewTutorial.youtubeVideoId}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  )
}
