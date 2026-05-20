export interface TutorialRecord {
  id: string
  title: string
  description: string
  category: TutorialCategory
  youtubeVideoId: string
  createdAt: string
  updatedAt: string
}

export const TUTORIAL_CATEGORIES = [
  "Getting Started",
  "Cases",
  "Billing",
  "Support",
  "Tips",
] as const

export type TutorialCategory = (typeof TUTORIAL_CATEGORIES)[number]

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/

export function extractYouTubeVideoId(input: string) {
  const value = input.trim()

  if (!value) return null
  if (YOUTUBE_VIDEO_ID_PATTERN.test(value)) return value

  try {
    const url = new URL(value)
    const hostname = url.hostname.replace(/^www\./, "")

    if (hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0]
      return id && YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null
    }

    if (hostname.endsWith("youtube.com")) {
      const fromSearch = url.searchParams.get("v")
      if (fromSearch && YOUTUBE_VIDEO_ID_PATTERN.test(fromSearch)) return fromSearch

      const segments = url.pathname.split("/").filter(Boolean)
      const embeddedId = segments[0] === "embed" || segments[0] === "shorts" ? segments[1] : null
      return embeddedId && YOUTUBE_VIDEO_ID_PATTERN.test(embeddedId) ? embeddedId : null
    }
  } catch {
    return null
  }

  return null
}

export function getYouTubeThumbnailUrl(videoId: string) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
}

export function getYouTubeEmbedUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`
}

export function isYouTubeVideoId(value: string) {
  return YOUTUBE_VIDEO_ID_PATTERN.test(value.trim())
}

export function isTutorialCategory(value: string): value is TutorialCategory {
  return (TUTORIAL_CATEGORIES as readonly string[]).includes(value)
}
