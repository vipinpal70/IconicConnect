'use client'

import { useRef, useState } from 'react'
import { AlertCircle, Download, FileText, Film, Image as ImageIcon, Loader2, RotateCcw, X } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import type { AttachmentView } from '@/src/lib/support/types'
import { ATTACHMENT_RETENTION_MONTHS, INLINE_IMAGE_TYPES, formatBytes, type AttachmentKind } from '@/src/lib/support/upload-policy'
import type { UploadItem } from './useUploads'

const fileUrl = (id: string, download = false) => `/api/support/attachments/${id}${download ? '?download=1' : ''}`

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  if (kind === 'image') return <ImageIcon className={className} aria-hidden />
  if (kind === 'video') return <Film className={className} aria-hidden />
  return <FileText className={className} aria-hidden />
}

// ── Composer: files being uploaded ────────────────────────────────────────────────────────────────

export function UploadTiles({
  items,
  onRemove,
  onRetry,
}: {
  items: UploadItem[]
  onRemove: (localId: string) => void
  onRetry: (localId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
      {items.map((item) => (
        <li
          key={item.localId}
          className={cn(
            'relative flex w-[200px] items-center gap-2 rounded-md border bg-background p-1.5 pr-7',
            item.status === 'error' ? 'border-destructive/60' : 'border-border',
          )}
        >
          {item.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={item.previewUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
              <KindIcon kind={item.kind} className="h-4 w-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium" title={item.name}>{item.name}</span>
            {item.status === 'error' ? (
              <button type="button" onClick={() => onRetry(item.localId)} className="flex items-center gap-1 text-[10px] text-destructive hover:underline">
                <RotateCcw className="h-3 w-3" aria-hidden /> {item.error || 'Failed'} · Retry
              </button>
            ) : item.status === 'uploading' ? (
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${item.name}`}>
                <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${item.progress}%` }} />
              </span>
            ) : (
              <span className="block text-[10px] text-muted-foreground">{formatBytes(item.size)}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onRemove(item.localId)}
            className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={item.status === 'uploading' ? `Cancel upload of ${item.name}` : `Remove ${item.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}

// ── Thread: files on a message ────────────────────────────────────────────────────────────────────

export function MessageAttachments({ attachments, onDark }: { attachments: AttachmentView[]; onDark: boolean }) {
  if (attachments.length === 0) return null
  const images = attachments.filter((a) => a.status === 'ready' && a.kind === 'image' && INLINE_IMAGE_TYPES.has(a.contentType))
  const videos = attachments.filter((a) => a.status === 'ready' && a.kind === 'video')
  const others = attachments.filter((a) => !images.includes(a) && !videos.includes(a))

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className={cn('grid gap-1', images.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {images.map((a) => (
            <ImageAttachment key={a.id} attachment={a} single={images.length === 1} onDark={onDark} />
          ))}
        </div>
      )}
      {videos.map((a) => (
        <VideoAttachment key={a.id} attachment={a} onDark={onDark} />
      ))}
      {others.map((a) => (
        <FileTile key={a.id} attachment={a} onDark={onDark} />
      ))}
    </div>
  )
}

/** Thumbnail that opens full size; falls back to a download tile if the image can't be shown. */
function ImageAttachment({ attachment, single, onDark }: { attachment: AttachmentView; single: boolean; onDark: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <FileTile attachment={attachment} onDark={onDark} />
  return (
    <a href={fileUrl(attachment.id)} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg bg-black/5" title={`${attachment.fileName} · open full size`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL via redirect */}
      <img
        src={fileUrl(attachment.id)}
        alt={attachment.fileName}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('w-full object-cover', single ? 'max-h-72' : 'h-32')}
      />
    </a>
  )
}

function FileTile({ attachment, onDark }: { attachment: AttachmentView; onDark: boolean }) {
  const expired = attachment.status === 'expired'
  const body = (
    <>
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded', onDark ? 'bg-white/15' : 'bg-background')}>
        {expired ? <AlertCircle className="h-4 w-4" aria-hidden /> : <KindIcon kind={attachment.kind} className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium">{attachment.fileName}</span>
        <span className={cn('block text-[10px]', onDark ? 'text-white/75' : 'text-muted-foreground')}>
          {expired ? `Removed after ${ATTACHMENT_RETENTION_MONTHS} months` : formatBytes(attachment.sizeBytes)}
        </span>
      </span>
      {!expired && <Download className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />}
    </>
  )
  const className = cn(
    'flex max-w-[260px] items-center gap-2 rounded-lg border p-1.5 text-left',
    onDark ? 'border-white/25 bg-white/10' : 'border-border bg-background/60',
    expired && 'opacity-70',
  )
  if (expired) return <div className={className}>{body}</div>
  return (
    <a href={fileUrl(attachment.id, true)} className={cn(className, 'hover:bg-black/5')} aria-label={`Download ${attachment.fileName}`}>
      {body}
    </a>
  )
}

/**
 * Streams from a short-lived signed URL (Range requests, so seeking doesn't download the whole file).
 * If the URL expires mid-playback, a fresh one is fetched and playback resumes where it was.
 */
function VideoAttachment({ attachment, onDark }: { attachment: AttachmentView; onDark: boolean }) {
  const [src, setSrc] = useState(fileUrl(attachment.id))
  const [state, setState] = useState<'ok' | 'reloading' | 'unplayable'>('ok')
  const resumeAt = useRef(0)
  const retried = useRef(false)

  if (state === 'unplayable') {
    return (
      <div className="space-y-1">
        <p className={cn('text-[10px]', onDark ? 'text-white/80' : 'text-muted-foreground')}>This video can’t be played in the browser. Download it instead.</p>
        <FileTile attachment={attachment} onDark={onDark} />
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-lg bg-black">
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        className="max-h-80 w-full"
        aria-label={attachment.fileName}
        onLoadedMetadata={(e) => {
          if (resumeAt.current > 0) e.currentTarget.currentTime = resumeAt.current
          retried.current = false // a long video may need a fresh link more than once
          setState('ok')
        }}
        onTimeUpdate={(e) => {
          resumeAt.current = e.currentTarget.currentTime
        }}
        onError={() => {
          if (retried.current) {
            setState('unplayable')
            return
          }
          retried.current = true
          setState('reloading')
          setSrc(`${fileUrl(attachment.id)}?r=${Date.now()}`)
        }}
      />
      {state === 'reloading' && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Reconnecting" />
        </span>
      )}
    </div>
  )
}
