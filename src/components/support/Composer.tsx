'use client'

import { useId, useRef, useState } from 'react'
import { Lock, MessageSquareText, Paperclip, Send } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import { MAX_MESSAGE_LENGTH } from '@/src/lib/support/constants'
import { ACCEPT_ATTRIBUTE, ATTACHMENT_RETENTION_MONTHS } from '@/src/lib/support/upload-policy'
import { UploadTiles } from './Attachments'
import type { useUploads } from './useUploads'
import type { CannedReply } from '@/src/lib/support/types'

interface ComposerProps {
  onSend: (body: string, visibility: 'public' | 'note', attachmentIds: string[]) => void
  /** Staff can switch to an internal note. */
  allowNotes: boolean
  placeholder: string
  /** Attachment uploads for this conversation (owned by the thread so drag & drop works anywhere on it). */
  uploads: ReturnType<typeof useUploads>
  /** Called while the person types (throttled by the caller) to show "… is typing" on the other side. */
  onTyping?: (visibility: 'public' | 'note') => void
  /** Staff: saved replies offered when typing "/" (variables already filled in by `renderTemplate`). */
  cannedReplies?: CannedReply[]
  renderTemplate?: (text: string) => string
  onManageCanned?: () => void
  disabled?: boolean
}

const MAX_ROWS_PX = 180
const MAX_SUGGESTIONS = 6

/** "/greet" right before the caret (at the start or after a space) opens the saved-reply picker. */
function slashToken(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)\/([a-z0-9-]*)$/i.exec(text.slice(0, caret))
  return match ? { start: caret - match[2].length - 1, query: match[2].toLowerCase() } : null
}

export function Composer({
  onSend,
  allowNotes,
  placeholder,
  uploads,
  onTyping,
  cannedReplies,
  renderTemplate,
  onManageCanned,
  disabled = false,
}: ComposerProps) {
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'note'>('public')
  const [caret, setCaret] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()

  const token = cannedReplies ? slashToken(body, caret) : null
  const suggestions =
    token && dismissedAt !== token.start
      ? (cannedReplies ?? [])
          .filter((r) => (r.shortcut ?? '').startsWith(token.query) || r.title.toLowerCase().includes(token.query))
          .slice(0, MAX_SUGGESTIONS)
      : []
  const pickerOpen = Boolean(token && dismissedAt !== token.start && cannedReplies)

  const insertReply = (reply: CannedReply) => {
    if (!token) return
    const text = renderTemplate ? renderTemplate(reply.body) : reply.body
    const next = body.slice(0, token.start) + text + body.slice(caret)
    const nextCaret = token.start + text.length
    setBody(next)
    setCaret(nextCaret)
    setActiveIndex(0)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
      resize(el)
    })
  }

  const openPicker = () => {
    const el = textareaRef.current
    const at = el?.selectionStart ?? body.length
    const needsSpace = at > 0 && !/\s/.test(body[at - 1] ?? '')
    const next = `${body.slice(0, at)}${needsSpace ? ' ' : ''}/${body.slice(at)}`
    const nextCaret = at + (needsSpace ? 2 : 1)
    setBody(next)
    setCaret(nextCaret)
    setDismissedAt(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(nextCaret, nextCaret)
    })
  }
  const note = visibility === 'note'
  const trimmed = body.trim()
  const tooLong = body.length > MAX_MESSAGE_LENGTH
  const hasFiles = uploads.items.length > 0
  // Sendable once every attachment has finished uploading (failed ones must be retried or removed)
  const canSend = !disabled && !tooLong && !uploads.uploading && !uploads.failed && (trimmed.length > 0 || uploads.readyIds.length > 0)

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`
  }

  const submit = () => {
    if (!canSend) return
    onSend(trimmed, visibility, uploads.readyIds)
    uploads.clear()
    setBody('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.focus()
    }
  }

  return (
    <div className={cn('border-t border-border/60 p-3', note && 'bg-amber-50/70')}>
      {allowNotes && (
        <div className="mb-2 flex gap-1" role="tablist" aria-label="Message type">
          {(['public', 'note'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={visibility === v}
              onClick={() => setVisibility(v)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                visibility === v
                  ? v === 'note'
                    ? 'bg-amber-200/70 text-amber-900'
                    : 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {v === 'note' && <Lock className="h-3 w-3" aria-hidden />}
              {v === 'public' ? 'Reply' : 'Internal note'}
            </button>
          ))}
        </div>
      )}
      <UploadTiles items={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} />
      <div className="relative flex items-end gap-2">
        {pickerOpen && (
          <div
            id={`${hintId}-canned`}
            role="listbox"
            aria-label="Saved replies"
            className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-lg border border-border bg-white shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
              <span>Saved replies · ↑↓ to choose · Enter to insert · Esc to close</span>
              {onManageCanned && (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onManageCanned} className="font-medium text-primary hover:underline">
                  Manage
                </button>
              )}
            </div>
            {suggestions.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">No saved reply matches “/{token?.query}”.</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto py-1">
                {suggestions.map((reply, i) => (
                  <li key={reply.id} id={`${hintId}-canned-${i}`} role="option" aria-selected={i === activeIndex}>
                    <button
                      type="button"
                      // Keep focus in the textarea so the caret position stays valid
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertReply(reply)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={cn('flex w-full flex-col px-3 py-1.5 text-left', i === activeIndex ? 'bg-primary/10' : 'hover:bg-muted/60')}
                    >
                      <span className="flex items-center gap-2 text-[11px] font-medium">
                        {reply.shortcut && <span className="font-mono text-primary">/{reply.shortcut}</span>}
                        {reply.title}
                        {reply.shared && <span className="rounded bg-muted px-1 text-[9px] font-normal text-muted-foreground">Shared</span>}
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">{reply.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) uploads.add(e.target.files)
            e.target.value = '' // allow picking the same file again
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="Attach files"
          title="Attach images, videos or documents (up to 500 MB each)"
        >
          <Paperclip className="h-4 w-4" aria-hidden />
        </button>
        {cannedReplies && (
          <button
            type="button"
            disabled={disabled}
            onClick={openPicker}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Insert a saved reply"
            title="Saved replies (or type / in the message)"
          >
            <MessageSquareText className="h-4 w-4" aria-hidden />
          </button>
        )}
        <label className="sr-only" htmlFor={`${hintId}-input`}>
          {note ? 'Internal note' : 'Message'}
        </label>
        <textarea
          id={`${hintId}-input`}
          ref={textareaRef}
          value={body}
          rows={1}
          disabled={disabled}
          aria-describedby={hintId}
          aria-controls={pickerOpen ? `${hintId}-canned` : undefined}
          aria-activedescendant={pickerOpen && suggestions[activeIndex] ? `${hintId}-canned-${activeIndex}` : undefined}
          placeholder={note ? 'Note for the support team (the lab never sees this)' : placeholder}
          onChange={(e) => {
            setBody(e.target.value)
            setCaret(e.target.selectionStart)
            setActiveIndex(0)
            resize(e.target)
            if (e.target.value.trim()) onTyping?.(visibility)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            // Pasted screenshots become attachments
            const pasted = Array.from(e.clipboardData.files)
            if (pasted.length > 0) {
              e.preventDefault()
              uploads.add(pasted)
            }
          }}
          onKeyDown={(e) => {
            if (pickerOpen && token) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const delta = e.key === 'ArrowDown' ? 1 : -1
                setActiveIndex((i) => (suggestions.length ? (i + delta + suggestions.length) % suggestions.length : 0))
                return
              }
              if ((e.key === 'Enter' || e.key === 'Tab') && suggestions[activeIndex]) {
                e.preventDefault()
                insertReply(suggestions[activeIndex])
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setDismissedAt(token.start)
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          className={cn(
            'min-h-[38px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-xs leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
            note ? 'border-amber-300 focus-visible:ring-amber-400' : 'border-input focus-visible:ring-primary',
          )}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label={note ? 'Add note' : 'Send message'}
          title={uploads.uploading ? 'Waiting for uploads to finish' : undefined}
          className={cn(
            'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40',
            note ? 'bg-amber-600 text-white' : 'bg-primary',
          )}
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p id={hintId} className="mt-1.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {hasFiles
            ? `Up to 500 MB per file · files are kept for ${ATTACHMENT_RETENTION_MONTHS} months, so download anything you need`
            : 'Enter to send · Shift + Enter for a new line · drop or paste files to attach'}
        </span>
        {body.length > MAX_MESSAGE_LENGTH - 1000 && (
          <span className={cn('shrink-0', tooLong && 'font-medium text-destructive')}>
            {body.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
          </span>
        )}
      </p>
    </div>
  )
}
