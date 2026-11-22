'use client'

import { useId, useRef, useState } from 'react'
import { Lock, Send } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import { MAX_MESSAGE_LENGTH } from '@/src/lib/support/constants'

interface ComposerProps {
  onSend: (body: string, visibility: 'public' | 'note') => void
  /** Staff can switch to an internal note. */
  allowNotes: boolean
  placeholder: string
  disabled?: boolean
}

const MAX_ROWS_PX = 180

export function Composer({ onSend, allowNotes, placeholder, disabled = false }: ComposerProps) {
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'note'>('public')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hintId = useId()
  const note = visibility === 'note'
  const trimmed = body.trim()
  const tooLong = body.length > MAX_MESSAGE_LENGTH

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`
  }

  const submit = () => {
    if (!trimmed || tooLong || disabled) return
    onSend(trimmed, visibility)
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
      <div className="flex items-end gap-2">
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
          placeholder={note ? 'Note for the support team (the lab never sees this)' : placeholder}
          onChange={(e) => {
            setBody(e.target.value)
            resize(e.target)
          }}
          onKeyDown={(e) => {
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
          disabled={!trimmed || tooLong || disabled}
          aria-label={note ? 'Add note' : 'Send message'}
          className={cn(
            'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40',
            note ? 'bg-amber-600 text-white' : 'bg-primary',
          )}
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p id={hintId} className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>Enter to send · Shift + Enter for a new line</span>
        {body.length > MAX_MESSAGE_LENGTH - 1000 && (
          <span className={cn(tooLong && 'font-medium text-destructive')}>
            {body.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
          </span>
        )}
      </p>
    </div>
  )
}
