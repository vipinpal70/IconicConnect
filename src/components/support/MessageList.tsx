'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, CheckCheck, Loader2, Lock, RotateCcw } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import type { SupportSide } from '@/src/lib/support/constants'
import type { MessageView } from '@/src/lib/support/types'
import { MessageText, clockTime, dayLabel } from './parts'

export interface PendingMessage {
  clientMsgId: string
  body: string
  visibility: 'public' | 'note'
  status: 'sending' | 'failed'
  createdAt: string
  error?: string
}

interface MessageListProps {
  messages: MessageView[]
  pending: PendingMessage[]
  viewerId: string
  viewerSide: SupportSide
  /** Highest seq the other side has read (read receipts). */
  otherSideReadSeq: number
  hasMoreBefore: boolean
  onLoadOlder: () => Promise<void>
  onRetry: (clientMsgId: string) => void
}

const GROUP_GAP_MS = 5 * 60_000

export function MessageList({
  messages,
  pending,
  viewerId,
  viewerSide,
  otherSideReadSeq,
  hasMoreBefore,
  onLoadOlder,
  onRetry,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const prependingRef = useRef<{ height: number } | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const lastKey = `${messages.at(-1)?.seq ?? 0}:${pending.length}`
  // Keep the view pinned to the newest message unless the user has scrolled up to read history
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependingRef.current) {
      el.scrollTop = el.scrollHeight - prependingRef.current.height
      prependingRef.current = null
    } else if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [lastKey, messages.length])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const loadOlder = async () => {
    const el = scrollRef.current
    prependingRef.current = el ? { height: el.scrollHeight } : null
    setLoadingOlder(true)
    try {
      await onLoadOlder()
    } finally {
      setLoadingOlder(false)
    }
  }

  // Read receipt only on the viewer's newest message the other side could see
  const lastOwnPublic = [...messages].reverse().find((m) => m.author?.id === viewerId && m.kind !== 'note')

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite" aria-relevant="additions">
      {hasMoreBefore && (
        <div className="mb-3 flex justify-center">
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            Load earlier messages
          </button>
        </div>
      )}

      <ol className="space-y-1">
        {messages.map((message, index) => {
          const previous = messages[index - 1]
          const newDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt)
          const grouped =
            !newDay &&
            previous?.author?.id === message.author?.id &&
            previous?.kind === message.kind &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_GAP_MS
          return (
            <li key={message.id}>
              {newDay && <DaySeparator iso={message.createdAt} />}
              <MessageItem
                message={message}
                own={message.author?.id === viewerId}
                viewerSide={viewerSide}
                grouped={grouped}
                receipt={message.id === lastOwnPublic?.id ? (otherSideReadSeq >= message.seq ? 'seen' : 'sent') : null}
              />
            </li>
          )
        })}
        {pending.map((p) => (
          <li key={p.clientMsgId}>
            <PendingItem pending={p} onRetry={() => onRetry(p.clientMsgId)} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center gap-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      {dayLabel(iso)}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function MessageItem({
  message,
  own,
  viewerSide,
  grouped,
  receipt,
}: {
  message: MessageView
  own: boolean
  viewerSide: SupportSide
  grouped: boolean
  receipt: 'seen' | 'sent' | null
}) {
  if (message.kind === 'system') {
    return (
      <p className="my-2 text-center text-[11px] text-muted-foreground">
        {message.body} · <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
      </p>
    )
  }

  if (message.kind === 'note') {
    return (
      <div className={cn('my-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2', grouped && 'mt-1')}>
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-amber-800">
          <Lock className="h-3 w-3" aria-hidden />
          Internal note · {message.author?.name} · {clockTime(message.createdAt)}
          <span className="font-normal">— only visible to the support team</span>
        </p>
        <p className="whitespace-pre-wrap break-words text-xs text-amber-950">
          <MessageText text={message.body} />
        </p>
      </div>
    )
  }

  // Own messages on the right; for agents, every support reply sits on the right as "our side"
  const right = own || (viewerSide === 'agent' && message.kind === 'agent')
  return (
    <div className={cn('flex flex-col', right ? 'items-end' : 'items-start', grouped ? 'mt-0.5' : 'mt-3')}>
      {!grouped && (
        <p className="mb-0.5 px-1 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{own ? 'You' : message.author?.name}</span> ·{' '}
          <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
        </p>
      )}
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-xs leading-relaxed sm:max-w-[75%]',
          right ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted text-foreground',
          message.deleted && 'italic opacity-70',
        )}
      >
        {message.deleted ? 'Message deleted' : <MessageText text={message.body} />}
      </div>
      {receipt && (
        <p className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          {receipt === 'seen' ? <CheckCheck className="h-3 w-3 text-primary" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
          {receipt === 'seen' ? 'Seen' : 'Sent'}
        </p>
      )}
    </div>
  )
}

function PendingItem({ pending, onRetry }: { pending: PendingMessage; onRetry: () => void }) {
  const note = pending.visibility === 'note'
  return (
    <div className="mt-2 flex flex-col items-end">
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3 py-2 text-xs sm:max-w-[75%]',
          note ? 'border border-amber-300 bg-amber-50 text-amber-950' : 'bg-primary/70 text-primary-foreground',
          pending.status === 'failed' && 'ring-2 ring-destructive/60',
        )}
      >
        {pending.body}
      </div>
      <p className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
        {pending.status === 'sending' ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Sending…
          </>
        ) : (
          <>
            <span className="text-destructive">{pending.error || 'Not sent'}</span>
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
              <RotateCcw className="h-3 w-3" aria-hidden /> Retry
            </button>
          </>
        )}
      </p>
    </div>
  )
}
