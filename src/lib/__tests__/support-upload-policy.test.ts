import { describe, expect, it } from 'vitest'
import { MAX_ATTACHMENT_BYTES, checkUpload, formatBytes, storageSafeName } from '@/src/lib/support/upload-policy'
import { postMessageSchema, uploadRequestSchema } from '@/src/lib/support/validation'

describe('support upload policy', () => {
  it('accepts images, videos and documents, and decides the content type itself', () => {
    expect(checkUpload('scan.PNG', 1000)).toMatchObject({ ok: true, kind: 'image', contentType: 'image/png' })
    expect(checkUpload('walkthrough.mov', 200 * 1024 * 1024)).toMatchObject({ ok: true, kind: 'video', contentType: 'video/quicktime' })
    expect(checkUpload('invoice.pdf', 5000)).toMatchObject({ ok: true, kind: 'document', contentType: 'application/pdf' })
  })

  it('rejects executables, web pages, unknown types and odd names', () => {
    for (const name of ['setup.exe', 'page.html', 'icon.svg', 'script.js', 'archive.rar', 'noextension', '../etc/passwd', 'a/b.png']) {
      expect(checkUpload(name, 100).ok, name).toBe(false)
    }
  })

  it('enforces the 500 MB limit and rejects empty files', () => {
    expect(checkUpload('big.mp4', MAX_ATTACHMENT_BYTES).ok).toBe(true)
    expect(checkUpload('big.mp4', MAX_ATTACHMENT_BYTES + 1)).toEqual({ ok: false, reason: 'Files can be at most 500 MB' })
    expect(checkUpload('empty.png', 0).ok).toBe(false)
  })

  it('makes storage-safe names but keeps the extension', () => {
    expect(storageSafeName('Upper jaw (final) #2.STL'.replace('STL', 'pdf'))).toBe('Upper_jaw_final_2.pdf')
    expect(storageSafeName('ëxämple.png')).toBe('example.png')
    expect(storageSafeName('...hidden.png')).toBe('hidden.png')
  })

  it('formats sizes for people', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB')
    expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB')
  })

  it('allows attachment-only messages but not empty ones, and caps attachments at 10', () => {
    const id = () => crypto.randomUUID()
    expect(postMessageSchema.safeParse({ body: '', clientMsgId: id(), attachmentIds: [id()] }).success).toBe(true)
    expect(postMessageSchema.safeParse({ body: '  ', clientMsgId: id() }).success).toBe(false)
    expect(postMessageSchema.safeParse({ body: 'x', clientMsgId: id(), attachmentIds: Array.from({ length: 11 }, id) }).success).toBe(false)
  })

  it('validates upload requests', () => {
    expect(uploadRequestSchema.safeParse({ action: 'init', fileName: 'a.png', fileSize: 10 }).success).toBe(true)
    expect(uploadRequestSchema.safeParse({ action: 'init', fileName: 'a.png', fileSize: -1 }).success).toBe(false)
    expect(uploadRequestSchema.safeParse({ action: 'complete', attachmentId: crypto.randomUUID(), parts: [] }).success).toBe(false)
  })
})
