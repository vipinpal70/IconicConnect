'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Star } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import { useRateTicket } from './api'

const LABELS = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent']

/** "How did we do?" after a conversation closes (CSAT). Asked once; the lab can skip it. */
export function RatingPrompt({ ticketId }: { ticketId: string }) {
  const [score, setScore] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const rate = useRateTicket(ticketId)
  const shown = hover || score

  return (
    <form
      className="border-t border-border/60 bg-amber-50/40 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!score) return
        rate.mutate(
          { score, comment: comment.trim() || null },
          { onSuccess: () => toast.success('Thanks for your feedback'), onError: (error) => toast.error(error.message) },
        )
      }}
    >
      <fieldset>
        <legend className="text-xs font-medium text-foreground">How did we do?</legend>
        <div className="mt-1.5 flex items-center gap-2">
          {/* Native radios: arrow keys, focus and screen readers work without extra code */}
          <div className="flex" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                onMouseEnter={() => setHover(n)}
                className="cursor-pointer rounded p-0.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
              >
                <input
                  type="radio"
                  name={`rating-${ticketId}`}
                  value={n}
                  checked={score === n}
                  onChange={() => setScore(n)}
                  className="sr-only"
                  aria-label={`${n} – ${LABELS[n]}`}
                />
                <Star className={cn('h-5 w-5 transition-colors', n <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} aria-hidden />
              </label>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground" aria-live="polite">{shown ? LABELS[shown] : 'Choose a rating'}</span>
        </div>
      </fieldset>
      {score > 0 && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="sr-only">Anything we could do better? (optional)</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Anything we could do better? (optional)"
              className="w-full resize-none rounded-md border border-input bg-white px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <button
            type="submit"
            disabled={rate.isPending}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {rate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Send rating
          </button>
        </div>
      )}
    </form>
  )
}
