'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Headset, LifeBuoy, MessageSquarePlus, PhoneCall, Search } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  type SupportCategory,
  type SupportPriority,
} from '@/src/lib/support/constants'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select'
import { useSupportMetrics, useSupportSummary, useTicketList } from './api'
import { formatDuration } from '@/src/lib/support/sla'
import type { SupportMetrics } from '@/src/lib/support/types'
import { useLiveStatus, useSupportStream } from './live'
import { TicketList } from './TicketList'
import { ThreadView } from './ThreadView'
import { NewConversationDialog } from './NewConversationDialog'
import { CallbackDialog } from './CallbackDialog'

type Mode = 'customer' | 'agent'

const VIEWS: Record<Mode, Array<{ id: string; label: string }>> = {
  customer: [
    { id: 'open', label: 'Open' },
    { id: 'closed', label: 'Closed' },
  ],
  agent: [
    { id: 'unassigned', label: 'Unassigned' },
    { id: 'mine', label: 'Mine' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'open', label: 'All open' },
    { id: 'closed', label: 'Closed' },
  ],
}

const ALL = '__all__'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/**
 * The support screen for both sides: a conversation list and the open thread. Labs see their own
 * conversations; agents get inbox views, filters and triage controls. `?ticket=<id>` opens a thread
 * (used by notification links).
 */
export function SupportWorkspace({ mode }: { mode: Mode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get('ticket')
  const agent = mode === 'agent'

  const [view, setView] = useState(agent ? 'unassigned' : 'open')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<SupportPriority | undefined>()
  const [category, setCategory] = useState<SupportCategory | undefined>()
  const [dialog, setDialog] = useState<null | { kind: 'new'; subject?: string } | { kind: 'callback' }>(null)
  const q = useDebounced(search.trim(), 300)

  useSupportStream()
  const liveStatus = useLiveStatus()
  const summary = useSupportSummary()
  const list = useTicketList({ view, q: q || undefined, priority, category })
  const tickets = useMemo(() => list.data?.pages.flatMap((p) => p.tickets) ?? [], [list.data])

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('ticket', id)
    else params.delete('ticket')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const created = (ticketId: string) => {
    setDialog(null)
    // Make sure the new conversation is visible in the list
    if (view === 'closed' || (agent && view === 'unassigned')) setView(agent ? 'mine' : 'open')
    select(ticketId)
  }

  const counts = summary.data
  const viewCount = (id: string) => {
    if (!counts || !agent) return null
    if (id === 'unassigned') return counts.newCount || null
    if (id === 'mine') return counts.mine || null
    if (id === 'overdue') return counts.overdue || null
    return null
  }
  const metrics = useSupportMetrics(agent)

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-primary p-4 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[10px] font-medium text-white/80">
              {agent ? <Headset className="h-3 w-3" aria-hidden /> : <LifeBuoy className="h-3 w-3" aria-hidden />}
              {agent ? 'Support inbox' : 'Support'}
            </div>
            <h1 className="flex items-center gap-2 text-md font-semibold text-white">
              {agent ? 'Conversations with labs' : 'How can we help?'}
              <span
                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80"
                title={liveStatus === 'live' ? 'Updates appear instantly' : 'Updates may be delayed while we reconnect'}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', liveStatus === 'live' ? 'bg-emerald-300' : 'bg-amber-300 animate-pulse')} aria-hidden />
                {liveStatus === 'live' ? 'Live' : 'Reconnecting…'}
              </span>
            </h1>
            <p className="mt-0.5 text-[11px] text-white/75">
              {agent
                ? `${counts?.newCount ?? 0} waiting to be picked up · ${counts?.unread ?? 0} with unread replies`
                : 'Chat with our team. Replies appear here and in your notifications.'}
            </p>
            {agent && metrics.data && <MetricsLine metrics={metrics.data} />}
          </div>
          <div className="flex gap-2">
            {!agent && (
              <button
                type="button"
                onClick={() => setDialog({ kind: 'callback' })}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-white/20"
              >
                <PhoneCall className="h-3.5 w-3.5" aria-hidden /> Request a callback
              </button>
            )}
            <button
              type="button"
              onClick={() => setDialog({ kind: 'new' })}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-white/90"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden /> New conversation
            </button>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100dvh-14rem)] min-h-[520px] overflow-hidden rounded-lg border border-border/60 bg-white shadow-sm">
        {/* List pane (hidden on small screens while a thread is open) */}
        <div className={cn('flex w-full flex-col border-r border-border/60 lg:w-[340px] lg:shrink-0', selectedId && 'hidden lg:flex')}>
          <div className="space-y-2 border-b border-border/60 p-2.5">
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Conversation views">
              {VIEWS[mode].map((v) => {
                const count = viewCount(v.id)
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={view === v.id}
                    onClick={() => setView(v.id)}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                      view === v.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {v.label}
                    {count ? (
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-[9px]',
                          view === v.id ? 'bg-white/20' : v.id === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-primary/10 text-primary',
                        )}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={agent ? 'Search subject, number, lab or message' : 'Search your conversations'}
                aria-label="Search conversations"
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            {agent && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={priority ?? ALL} onValueChange={(v) => setPriority(v === ALL ? undefined : (v as SupportPriority))}>
                  <SelectTrigger className="h-7 text-[11px]" aria-label="Filter by priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL} className="text-xs">Any priority</SelectItem>
                    {SUPPORT_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">{PRIORITY_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={category ?? ALL} onValueChange={(v) => setCategory(v === ALL ? undefined : (v as SupportCategory))}>
                  <SelectTrigger className="h-7 text-[11px]" aria-label="Filter by topic">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL} className="text-xs">Any topic</SelectItem>
                    {SUPPORT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">{CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TicketList
              tickets={tickets}
              selectedId={selectedId}
              onSelect={select}
              viewerSide={agent ? 'agent' : 'customer'}
              isLoading={list.isLoading}
              error={list.error}
              onRetry={() => void list.refetch()}
              hasMore={Boolean(list.hasNextPage)}
              isLoadingMore={list.isFetchingNextPage}
              onLoadMore={() => void list.fetchNextPage()}
              emptyText={
                q
                  ? 'No conversations match your search.'
                  : agent
                    ? view === 'unassigned' ? 'Nothing waiting. Every conversation has an owner.' : view === 'overdue' ? 'Nothing overdue. Every lab has had a reply in time.' : 'No conversations here.'
                    : view === 'closed' ? 'No closed conversations yet.' : 'No open conversations. Start one if you need help.'
              }
            />
          </div>
        </div>

        {/* Thread pane */}
        <div className={cn('min-w-0 flex-1 flex-col', selectedId ? 'flex' : 'hidden lg:flex')}>
          {selectedId ? (
            <ThreadView
              key={selectedId}
              ticketId={selectedId}
              onBack={() => select(null)}
              onStartFollowUp={agent ? undefined : (subject) => setDialog({ kind: 'new', subject })}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-xs text-muted-foreground">
              <MessageSquarePlus className="h-7 w-7 opacity-50" aria-hidden />
              <p>{agent ? 'Select a conversation to read and reply.' : 'Select a conversation, or start a new one.'}</p>
            </div>
          )}
        </div>
      </div>

      <NewConversationDialog
        open={dialog?.kind === 'new'}
        onOpenChange={(open) => !open && setDialog(null)}
        mode={mode}
        initialSubject={dialog?.kind === 'new' ? dialog.subject : undefined}
        onCreated={created}
      />
      {!agent && (
        <CallbackDialog open={dialog?.kind === 'callback'} onOpenChange={(open) => !open && setDialog(null)} onCreated={created} />
      )}
    </div>
  )
}

/** Team numbers for the last 30 days, in the inbox header (support-system.md §10). */
function MetricsLine({ metrics }: { metrics: SupportMetrics }) {
  const onTime = metrics.firstResponseMeasured > 0 ? Math.round((metrics.firstResponseOnTime / metrics.firstResponseMeasured) * 100) : null
  const parts = [
    `${metrics.created} new`,
    metrics.medianFirstResponseMinutes !== null ? `first reply in ${formatDuration(metrics.medianFirstResponseMinutes * 60_000)} (median)` : null,
    onTime !== null ? `${onTime}% on time` : null,
    metrics.rating.average !== null ? `rated ${metrics.rating.average}/5 (${metrics.rating.count})` : 'no ratings yet',
  ].filter(Boolean)
  return (
    <p className="mt-0.5 text-[10px] text-white/65" aria-label="Last 30 days">
      Last {metrics.days} days: {parts.join(' · ')}
    </p>
  )
}
