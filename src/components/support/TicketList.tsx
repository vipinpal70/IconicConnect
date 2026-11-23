'use client'

import { Inbox, Loader2 } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import type { SupportSide } from '@/src/lib/support/constants'
import type { TicketSummary } from '@/src/lib/support/types'
import { PriorityLabel, SlaBadge, StatusBadge, WaitingBadge, relativeTime } from './parts'

interface TicketListProps {
  tickets: TicketSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  viewerSide: SupportSide
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  emptyText: string
}

export function TicketList({
  tickets,
  selectedId,
  onSelect,
  viewerSide,
  isLoading,
  error,
  onRetry,
  hasMore,
  isLoadingMore,
  onLoadMore,
  emptyText,
}: TicketListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading conversations">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-muted/60" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <p>{error.message}</p>
        <button type="button" onClick={onRetry} className="font-medium text-primary hover:underline">
          Try again
        </button>
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center text-xs text-muted-foreground">
        <Inbox className="h-6 w-6 opacity-60" aria-hidden />
        <p>{emptyText}</p>
      </div>
    )
  }

  return (
    <div>
      <ul role="listbox" aria-label="Conversations" className="divide-y divide-border/60">
        {tickets.map((ticket) => {
          const selected = ticket.id === selectedId
          return (
            <li key={ticket.id} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() => onSelect(ticket.id)}
                className={cn(
                  'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  selected ? 'bg-primary/5' : 'hover:bg-muted/50',
                )}
              >
                <div className="flex items-center gap-2">
                  {ticket.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                  <span className={cn('min-w-0 flex-1 truncate text-xs', ticket.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90')}>
                    {ticket.subject}
                  </span>
                  <time dateTime={ticket.lastMessageAt} className="shrink-0 text-[10px] text-muted-foreground">
                    {relativeTime(ticket.lastMessageAt)}
                  </time>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="font-mono">{ticket.number}</span>
                  {viewerSide === 'agent' && <span className="truncate">· {ticket.lab.name}</span>}
                  <StatusBadge status={ticket.status} />
                  <WaitingBadge status={ticket.status} lastPublicSender={ticket.lastPublicSender} viewerSide={viewerSide} />
                  {viewerSide === 'agent' && <PriorityLabel priority={ticket.priority} />}
                  {viewerSide === 'agent' && <SlaBadge dueAt={ticket.replyDueAt} warnAt={ticket.replyWarnAt} />}
                </div>
                {ticket.preview && <p className="truncate text-[11px] text-muted-foreground">{ticket.preview}</p>}
                {viewerSide === 'agent' && (
                  <p className="text-[10px] text-muted-foreground">{ticket.assignee ? `Assigned to ${ticket.assignee.name}` : 'Unassigned'}</p>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {hasMore && (
        <div className="p-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[11px] font-medium text-primary hover:bg-muted/60 disabled:opacity-60"
          >
            {isLoadingMore && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
