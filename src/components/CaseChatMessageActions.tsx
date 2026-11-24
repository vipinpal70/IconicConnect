"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Pencil, Trash2 } from "lucide-react"
import { MAX_CHAT_EDIT_LENGTH, formatTimeLeft } from "@/src/lib/chat-rules"

const buttonClass =
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-60"

/**
 * Edit / Delete on the viewer's own message while it can still be changed. Always visible (not on hover),
 * so it works on touch screens; gone when the time is up.
 */
export function CaseChatMessageActions({ canEdit, timeLeft, busy, onEdit, onDelete }: {
  canEdit: boolean
  timeLeft: number
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="mt-1 flex flex-wrap items-center justify-end gap-1" role="group" aria-label="Delete message">
        <span className="text-[10px]">Delete for everyone?</span>
        <button type="button" className={buttonClass} disabled={busy} autoFocus onClick={onDelete}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          Yes, delete
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirming(false)}>
          Keep
        </button>
      </div>
    )
  }

  return (
    <div className="mt-1 flex items-center justify-end gap-1">
      <span className="text-[10px] tabular-nums opacity-90" title="Time left to change this message">
        {formatTimeLeft(timeLeft)} left
      </span>
      {canEdit && (
        <button type="button" className={buttonClass} disabled={busy} onClick={onEdit}>
          <Pencil className="h-3 w-3" aria-hidden /> Edit
        </button>
      )}
      <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirming(true)}>
        <Trash2 className="h-3 w-3" aria-hidden /> Delete
      </button>
    </div>
  )
}

/** In-place editor: Enter saves, Shift+Enter adds a line, Esc cancels. */
export function CaseChatEditor({ initialText, timeLeft, saving, onSave, onCancel }: {
  initialText: string
  timeLeft: number
  saving: boolean
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialText)
  const ref = useRef<HTMLTextAreaElement>(null)
  const expired = timeLeft <= 0
  const trimmed = value.trim()
  const canSave = !expired && !saving && trimmed.length > 0

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const save = () => {
    if (!canSave) return
    if (trimmed === initialText) onCancel()
    else onSave(trimmed)
  }

  return (
    <div data-chat-editor className="w-64 max-w-full">
      <textarea
        ref={ref}
        value={value}
        rows={3}
        maxLength={MAX_CHAT_EDIT_LENGTH}
        disabled={saving}
        aria-label="Edit message"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            save()
          } else if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        className="w-full resize-y rounded-md border border-input bg-white px-2 py-1 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      />
      <div className="mt-1 flex items-center justify-end gap-1">
        <span className="mr-auto text-[10px] tabular-nums" role={expired ? "alert" : undefined}>
          {expired ? "Time is up" : `${formatTimeLeft(timeLeft)} left`}
        </span>
        <button type="button" className={buttonClass} disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={buttonClass} disabled={!canSave} onClick={save}>
          {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          Save
        </button>
      </div>
    </div>
  )
}
