/**
 * What may be attached to a support message (support-system.md §8). Pure and dependency-free so the
 * browser can check files before uploading and the server applies exactly the same rules.
 *
 * The content type stored and served is decided here from the extension, never taken from the browser:
 * a file is always served as what its extension says, so an HTML or script file can't sneak through
 * under an image name and run when opened.
 */

export const MAX_ATTACHMENT_BYTES = 500 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 10
/** Multipart part size (R2 minimum is 5 MB; 64 MB matches the case uploader). */
export const UPLOAD_PART_BYTES = 64 * 1024 * 1024
/** Existing R2 retention policy: objects are deleted after this many months. */
export const ATTACHMENT_RETENTION_MONTHS = 3

export type AttachmentKind = 'image' | 'video' | 'document'

const TYPES: Record<string, { kind: AttachmentKind; contentType: string }> = {
  jpg: { kind: 'image', contentType: 'image/jpeg' },
  jpeg: { kind: 'image', contentType: 'image/jpeg' },
  png: { kind: 'image', contentType: 'image/png' },
  webp: { kind: 'image', contentType: 'image/webp' },
  gif: { kind: 'image', contentType: 'image/gif' },
  heic: { kind: 'image', contentType: 'image/heic' },
  heif: { kind: 'image', contentType: 'image/heif' },
  mp4: { kind: 'video', contentType: 'video/mp4' },
  m4v: { kind: 'video', contentType: 'video/mp4' },
  mov: { kind: 'video', contentType: 'video/quicktime' },
  webm: { kind: 'video', contentType: 'video/webm' },
  pdf: { kind: 'document', contentType: 'application/pdf' },
  txt: { kind: 'document', contentType: 'text/plain; charset=utf-8' },
  csv: { kind: 'document', contentType: 'text/csv; charset=utf-8' },
  docx: { kind: 'document', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { kind: 'document', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { kind: 'document', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  zip: { kind: 'document', contentType: 'application/zip' },
}

/** For the file picker's `accept` attribute. */
export const ACCEPT_ATTRIBUTE = Object.keys(TYPES).map((ext) => `.${ext}`).join(',')

/** Images the browser can show inline (HEIC usually can't; it downloads instead). */
export const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type UploadCheck =
  | { ok: true; kind: AttachmentKind; contentType: string; extension: string }
  | { ok: false; reason: string }

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

export function checkUpload(fileName: string, sizeBytes: number): UploadCheck {
  if (!fileName || fileName.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(fileName) || fileName === '.' || fileName === '..') {
    return { ok: false, reason: 'That file name is not allowed' }
  }
  const extension = extensionOf(fileName)
  const type = TYPES[extension]
  if (!type) return { ok: false, reason: `.${extension || '?'} files can't be attached. Use images, videos, PDFs or office documents.` }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, reason: 'The file is empty' }
  if (sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'Files can be at most 500 MB' }
  return { ok: true, kind: type.kind, contentType: type.contentType, extension }
}

/** Storage-safe version of a file name (the original is kept for display and downloads). */
export function storageSafeName(fileName: string): string {
  const extension = extensionOf(fileName)
  const stem = fileName.slice(0, fileName.length - (extension ? extension.length + 1 : 0))
  const safeStem =
    stem
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // drop accent marks: "ë" → "e"
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^[._]+|_+$/g, '')
      .slice(0, 80) || 'file'
  return extension ? `${safeStem}.${extension}` : safeStem
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
