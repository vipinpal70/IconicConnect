'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AttachmentView, UploadStart } from '@/src/lib/support/types'
import { INLINE_IMAGE_TYPES, MAX_ATTACHMENTS_PER_MESSAGE, checkUpload, type AttachmentKind } from '@/src/lib/support/upload-policy'

/**
 * Attachment uploads for the composer (support-system.md §8): files are checked instantly, then sent
 * straight to storage in parts (3 at a time, each part retried), with real progress, cancel and retry.
 * Finished uploads are referenced by id when the message is sent.
 */

export interface UploadItem {
  localId: string
  file: File
  name: string
  size: number
  kind: AttachmentKind
  /** Local thumbnail for images the browser can show. */
  previewUrl: string | null
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
  attachmentId?: string
}

const PARALLEL_PARTS = 3
const PART_RETRIES = 3

async function api<T>(body: unknown): Promise<T> {
  const res = await fetch('/api/support/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || 'Upload failed')
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void, register: (xhr: XMLHttpRequest) => void) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    register(xhr)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded)
    xhr.onload = () => {
      const etag = xhr.getResponseHeader('ETag')
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag)
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'))
    xhr.open('PUT', url, true)
    xhr.send(blob)
  })
}

export function useUploads(ticketId?: string) {
  const [items, setItems] = useState<UploadItem[]>([])
  const inflight = useRef(new Map<string, { xhrs: Set<XMLHttpRequest>; cancelled: boolean }>())

  const patch = useCallback((localId: string, change: Partial<UploadItem>) => {
    setItems((list) => list.map((i) => (i.localId === localId ? { ...i, ...change } : i)))
  }, [])

  const run = useCallback(
    async (item: UploadItem) => {
      const control = { xhrs: new Set<XMLHttpRequest>(), cancelled: false }
      inflight.current.set(item.localId, control)
      patch(item.localId, { status: 'uploading', progress: 0, error: undefined })
      try {
        const start = await api<UploadStart>({ action: 'init', fileName: item.name, fileSize: item.size, ticketId })
        patch(item.localId, { attachmentId: start.attachmentId })
        if (control.cancelled) throw new DOMException('Cancelled', 'AbortError')

        const loaded = new Array(start.parts.length).fill(0)
        const etags: Array<{ partNumber: number; etag: string }> = []
        const queue = [...start.parts]
        const worker = async () => {
          for (let part = queue.shift(); part; part = queue.shift()) {
            const from = (part.partNumber - 1) * start.partSize
            const blob = item.file.slice(from, Math.min(from + start.partSize, item.size))
            let lastError: unknown
            for (let attempt = 0; attempt < PART_RETRIES; attempt++) {
              if (control.cancelled) throw new DOMException('Cancelled', 'AbortError')
              try {
                const index = part.partNumber - 1
                const etag = await putPart(
                  part.url,
                  blob,
                  (bytes) => {
                    loaded[index] = bytes
                    const total = loaded.reduce((a, b) => a + b, 0)
                    patch(item.localId, { progress: Math.min(99, Math.round((total / item.size) * 100)) })
                  },
                  (xhr) => control.xhrs.add(xhr),
                )
                etags.push({ partNumber: part.partNumber, etag })
                lastError = null
                break
              } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') throw error
                lastError = error
                await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
              }
            }
            if (lastError) throw lastError
          }
        }
        await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, start.parts.length) }, worker))

        await api<AttachmentView>({ action: 'complete', attachmentId: start.attachmentId, parts: etags })
        patch(item.localId, { status: 'done', progress: 100 })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        patch(item.localId, { status: 'error', error: error instanceof Error ? error.message : 'Upload failed' })
      } finally {
        inflight.current.delete(item.localId)
      }
    },
    [patch, ticketId],
  )

  const add = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList)
      const room = MAX_ATTACHMENTS_PER_MESSAGE - items.length
      if (incoming.length > room) toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`)
      const accepted: UploadItem[] = []
      for (const file of incoming.slice(0, Math.max(0, room))) {
        const check = checkUpload(file.name, file.size)
        if (!check.ok) {
          toast.error(`${file.name}: ${check.reason}`)
          continue
        }
        accepted.push({
          localId: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          kind: check.kind,
          previewUrl: check.kind === 'image' && INLINE_IMAGE_TYPES.has(check.contentType) ? URL.createObjectURL(file) : null,
          progress: 0,
          status: 'uploading',
        })
      }
      if (accepted.length === 0) return
      setItems((list) => [...list, ...accepted])
      accepted.forEach((item) => void run(item))
    },
    [items.length, run],
  )

  const cancelInflight = (localId: string) => {
    const control = inflight.current.get(localId)
    if (control) {
      control.cancelled = true
      control.xhrs.forEach((xhr) => xhr.abort())
    }
  }

  const remove = useCallback(
    (localId: string) => {
      const item = items.find((i) => i.localId === localId)
      if (item) {
        cancelInflight(localId)
        if (item.attachmentId) void api({ action: 'abort', attachmentId: item.attachmentId }).catch(() => {})
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
      setItems((list) => list.filter((i) => i.localId !== localId))
    },
    [items],
  )

  const retry = useCallback(
    (localId: string) => {
      const item = items.find((i) => i.localId === localId)
      if (!item) return
      if (item.attachmentId) void api({ action: 'abort', attachmentId: item.attachmentId }).catch(() => {})
      void run({ ...item, attachmentId: undefined })
    },
    [items, run],
  )

  /** After a successful send: the uploads now belong to the message, so just forget them locally. */
  const clear = useCallback(() => {
    items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl))
    setItems([])
  }, [items])

  // Leaving the conversation cancels uploads still in flight (finished-but-unsent ones are reaped server-side)
  useEffect(() => {
    const current = inflight.current
    return () => {
      current.forEach((control) => {
        control.cancelled = true
        control.xhrs.forEach((xhr) => xhr.abort())
      })
    }
  }, [])

  const uploading = items.some((i) => i.status === 'uploading')
  const failed = items.some((i) => i.status === 'error')
  const readyIds = items.filter((i) => i.status === 'done' && i.attachmentId).map((i) => i.attachmentId!)

  return { items, add, remove, retry, clear, uploading, failed, readyIds }
}
