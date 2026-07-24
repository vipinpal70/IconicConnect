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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/src/components/ui/select"
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
    <Card className="group overflow-hidden border-border/60 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated text-xs">
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
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/30 transition-transform group-hover:scale-105">
              <PlayCircle className="h-5 w-5 text-white drop-shadow" />
            </div>
          </div>
          <div className="absolute left-2.5 top-2.5 flex gap-2 scale-90 origin-top-left">
            <Badge className="border-white/20 bg-black/35 text-white">YouTube</Badge>
          </div>
          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-0.5 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-medium text-white backdrop-blur">
            <Clock3 className="h-2.5 w-2.5" />
            {formatDate(tutorial.createdAt)}
          </div>
        </div>
      </button>
      <CardContent className="space-y-3 p-3">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Badge variant="secondary" className="mb-1 text-[9px] font-semibold  uppercase tracking-wider px-1.5 py-0">
                {tutorial.category}
              </Badge>
              <h3 className="line-clamp-1 text-xs font-semibold  text-slate-800">{tutorial.title}</h3>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground leading-normal">{tutorial.description}</p>
            </div>
          </div>
          <p className="break-all text-[10px] text-muted-foreground">{tutorial.youtubeVideoId}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 gap-1" onClick={() => onPreview(tutorial)}>
            <PlayCircle className="h-3.5 w-3.5" />
            Preview
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] px-2 gap-1 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={() => onDelete(tutorial)}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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
      <div className="space-y-4 animate-in fade-in duration-500">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-0.5">
            <h1 className="text-lg font-semibold text-foreground">Tutorials</h1>
            <p className="text-xs text-muted-foreground">
              Upload tutorials, preview them live, and manage what the client portal shows.
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
            <Video className="h-3.5 w-3.5 text-red-500" />
            {tutorials.length} published
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <Card className="shadow-card border-border/60 text-xs">
            <CardHeader className="p-3.5 pb-2 border-b border-border/60 space-y-0.5">
              <CardTitle className="text-xs font-semibold ">Add Tutorial</CardTitle>
              <p className="text-[11px] text-muted-foreground">Paste a YouTube video ID and publish it to both portals.</p>
            </CardHeader>
            <CardContent className="p-3.5">
              <form className="space-y-3" onSubmit={handleSubmit}>
                <div className="space-y-1">
                  <Label htmlFor="tutorial-category" className="text-xs">Category</Label>
                  <Select
                    value={form.category}
                    onValueChange={(val) => {
                      setForm((current) => ({ ...current, category: val as TutorialCategory }))
                      if (errors.category) setErrors((current) => ({ ...current, category: undefined }))
                    }}
                    disabled={createMutation.isPending}
                  >
                    <SelectTrigger id="tutorial-category" className="h-8 w-full bg-white border border-input text-gray-900 rounded px-3 text-xs focus:ring-1 focus:ring-ring focus:ring-offset-0">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-gray-200 text-gray-900 max-h-60 overflow-y-auto">
                      {TUTORIAL_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category} className="cursor-pointer hover:bg-gray-100 text-xs">
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.category && <p className="text-[10px] text-red-500">{errors.category}</p>}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tutorial-title" className="text-xs">Title</Label>
                  <Input
                    id="tutorial-title"
                    className="h-8 text-xs"
                    placeholder="e.g. Getting started with Iconic Connect"
                    value={form.title}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, title: event.target.value }))
                      if (errors.title) setErrors((current) => ({ ...current, title: undefined }))
                    }}
                  />
                  {errors.title && <p className="text-[10px] text-red-500">{errors.title}</p>}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tutorial-video-id" className="text-xs">YouTube Video ID</Label>
                  <Input
                    id="tutorial-video-id"
                    className="h-8 text-xs"
                    placeholder="dQw4w9WgXcQ"
                    value={form.youtubeVideoId}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, youtubeVideoId: event.target.value }))
                      if (errors.youtubeVideoId) setErrors((current) => ({ ...current, youtubeVideoId: undefined }))
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground leading-normal">
                    Use the 11-character ID from YouTube. A full URL also works if it contains a valid ID.
                  </p>
                  {errors.youtubeVideoId && <p className="text-[10px] text-red-500">{errors.youtubeVideoId}</p>}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tutorial-description" className="text-xs">Description</Label>
                  <Textarea
                    id="tutorial-description"
                    rows={4}
                    className="text-xs"
                    placeholder="Explain what the tutorial covers and what users will learn."
                    value={form.description}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, description: event.target.value }))
                      if (errors.description) setErrors((current) => ({ ...current, description: undefined }))
                    }}
                  />
                  {errors.description && <p className="text-[10px] text-red-500">{errors.description}</p>}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="text-[10px] text-muted-foreground max-w-[200px] leading-tight">
                    {liveVideoId ? "Live preview is ready." : "Preview appears automatically after a valid video ID is entered."}
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 text-xs gap-1.5 border-none bg-primary shadow-glow px-4"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Publish Tutorial
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="shadow-card border-border/60 overflow-hidden text-xs">
            <CardHeader className="p-3.5 pb-2 border-b border-border/60 space-y-0.5">
              <CardTitle className="text-xs font-semibold ">Live Preview</CardTitle>
              <p className="text-[11px] text-muted-foreground">This is the exact embedded player users will see.</p>
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
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Video className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="font-semibold  text-foreground">No preview yet</p>
                      <p className="text-xs text-muted-foreground">
                        Add a valid YouTube video ID to render the embed here.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid gap-3 border-t border-border/60 p-3.5 sm:grid-cols-2">
                <div>
                  <p className="text-[9px] font-semibold  uppercase tracking-wider text-muted-foreground">Title</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-800">{form.title.trim() || "Untitled tutorial"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold  uppercase tracking-wider text-muted-foreground">Video ID</p>
                  <p className="mt-0.5 break-all text-[11px] font-semibold text-slate-800">{liveVideoId || "Waiting for a valid ID"}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[9px] font-semibold  uppercase tracking-wider text-muted-foreground">Description</p>
                  <p className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground leading-normal">
                    {form.description.trim() || "Add a description to help clients understand the tutorial."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/60">
          <CardHeader className="p-3.5 pb-2 border-b border-border/60 gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
            <div className="space-y-0.5">
              <CardTitle className="text-xs font-semibold ">Uploaded Tutorials</CardTitle>
              <p className="text-[11px] text-muted-foreground">Delete or preview any tutorial at any time.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs border bg-muted/20"
                placeholder="Search tutorials..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-3.5">
            {tutorialsQuery.isLoading ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="overflow-hidden rounded-lg border border-border/60">
                    <div className="aspect-video animate-pulse bg-muted" />
                    <div className="space-y-2 p-3">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                      <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
                      <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
                      <div className="flex justify-between gap-3 pt-1">
                        <div className="h-7 w-16 animate-pulse rounded bg-muted" />
                        <div className="h-7 w-16 animate-pulse rounded bg-muted" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : tutorialsQuery.error ? (
              <div className="flex flex-col items-center justify-center rounded border border-dashed border-red-200 bg-red-50 px-4 py-8 text-center dark:border-red-900/60 dark:bg-red-950/20 text-xs">
                <AlertCircle className="h-8 w-8 text-red-500" />
                <h3 className="mt-2 text-xs font-semibold  text-foreground">Failed to load tutorials</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {(tutorialsQuery.error as Error).message}
                </p>
                <Button className="mt-3 h-8 text-xs" variant="outline" onClick={() => tutorialsQuery.refetch()}>
                  Try again
                </Button>
              </div>
            ) : filteredTutorials.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded border border-dashed border-border/60 px-4 py-8 text-center text-xs">
                <Video className="h-8 w-8 text-muted-foreground" />
                <h3 className="mt-2 text-xs font-semibold  text-foreground">
                  {search ? "No tutorials match your search" : "No tutorials uploaded yet"}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground leading-normal max-w-xs">
                  {search
                    ? "Try a different title, description, or video ID."
                    : "Use the form above to publish the first tutorial."}
                </p>
              </div>
            ) : (
              <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
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
          <DialogContent className="max-w-4xl text-xs">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold ">{previewTutorial?.title}</DialogTitle>
            </DialogHeader>
            {previewTutorial && (
              <div className="space-y-3">
                <div className="aspect-video overflow-hidden rounded bg-black">
                  <iframe
                    className="h-full w-full"
                    src={getYouTubeEmbedUrl(previewTutorial.youtubeVideoId)}
                    title={previewTutorial.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
                <div className="space-y-1 leading-normal">
                  <p className="text-xs text-muted-foreground">{previewTutorial.description}</p>
                  <p className="text-[10px] text-muted-foreground">Video ID: {previewTutorial.youtubeVideoId}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  )
}
