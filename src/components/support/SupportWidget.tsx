'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Headset, Loader2, MessageSquarePlus, PhoneCall, X } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import { CATEGORY_LABELS, CUSTOMER_CATEGORIES, MAX_MESSAGE_LENGTH, type SupportCategory } from '@/src/lib/support/constants'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select'
import { newClientMsgId, useCreateTicket, useSupportSummary, useTicketList } from './api'
import { useSupportStream } from './live'
import { ThreadView } from './ThreadView'
import { CallbackDialog } from './CallbackDialog'
import { StatusBadge, relativeTime } from './parts'

type View = { kind: 'home' } | { kind: 'new' } | { kind: 'thread'; ticketId: string }

/**
 * Floating support button for lab pages (support-system.md §7b). It is another view of the same
 * conversations as the Support page: same API, same live stream, no separate data.
 */
export function SupportWidget() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [callbackOpen, setCallbackOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useSupportStream()
  const summary = useSupportSummary()
  const unread = summary.data?.unread ?? 0

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !callbackOpen && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, callbackOpen])

  // The Support page already shows everything; don't stack a second copy on top of it
  if (pathname?.startsWith('/client/support')) return null

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
          aria-label={unread > 0 ? `Support, ${unread} unread` : 'Support'}
        >
          <Headset className="h-5 w-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-background">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Support chat"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white shadow-2xl sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:max-h-[calc(100dvh-2.5rem)] sm:w-[390px] sm:rounded-xl sm:border sm:border-border/60"
        >
          {view.kind === 'thread' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <ThreadView
                key={view.ticketId}
                ticketId={view.ticketId}
                compact
                onBack={() => setView({ kind: 'home' })}
                onStartFollowUp={() => setView({ kind: 'new' })}
              />
            </div>
          ) : (
            <>
              <header className="bg-primary px-4 pb-4 pt-3 text-primary-foreground">
                <div className="flex items-center justify-between">
                  {view.kind === 'new' ? (
                    <button type="button" onClick={() => setView({ kind: 'home' })} className="-ml-1 rounded p-1 hover:bg-white/10" aria-label="Back">
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <Headset className="h-4 w-4" aria-hidden /> Support
                    </span>
                  )}
                  <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-white/10" aria-label="Close support chat">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-base font-semibold">{view.kind === 'new' ? 'New conversation' : 'Hi! How can we help?'}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/80">
                  <span className={cn('h-2 w-2 rounded-full', summary.data?.agentsOnline ? 'bg-emerald-300' : 'bg-white/40')} aria-hidden />
                  {summary.data?.agentsOnline
                    ? 'We’re online · usually reply within a few minutes'
                    : 'We’ll reply here as soon as we’re back, and notify you'}
                </p>
              </header>
              {view.kind === 'new' ? (
                <QuickStart onCreated={(ticketId) => setView({ kind: 'thread', ticketId })} />
              ) : (
                <Home
                  onOpen={(ticketId) => setView({ kind: 'thread', ticketId })}
                  onNew={() => setView({ kind: 'new' })}
                  onCallback={() => setCallbackOpen(true)}
                />
              )}
            </>
          )}
        </div>
      )}

      <CallbackDialog
        open={callbackOpen}
        onOpenChange={setCallbackOpen}
        onCreated={(ticketId) => {
          setCallbackOpen(false)
          setOpen(true)
          setView({ kind: 'thread', ticketId })
        }}
      />
    </>
  )
}

function Home({ onOpen, onNew, onCallback }: { onOpen: (id: string) => void; onNew: () => void; onCallback: () => void }) {
  const list = useTicketList({ view: 'open' })
  const tickets = useMemo(() => (list.data?.pages.flatMap((p) => p.tickets) ?? []).slice(0, 6), [list.data])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="grid grid-cols-2 gap-2 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-left hover:border-primary/50 hover:bg-primary/5"
        >
          <MessageSquarePlus className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-xs font-semibold">Start a conversation</span>
          <span className="text-[10px] text-muted-foreground">Chat with our team</span>
        </button>
        <button
          type="button"
          onClick={onCallback}
          className="flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-left hover:border-primary/50 hover:bg-primary/5"
        >
          <PhoneCall className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-xs font-semibold">Request a callback</span>
          <span className="text-[10px] text-muted-foreground">We’ll phone you</span>
        </button>
      </div>

      <div className="px-3 pb-3">
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Your open conversations</h3>
        {list.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <p className="rounded-md bg-muted/40 p-3 text-center text-[11px] text-muted-foreground">No open conversations.</p>
        ) : (
          <ul className="space-y-1.5">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex w-full flex-col gap-0.5 rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/50"
                >
                  <span className="flex items-center gap-2">
                    {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    <span className={cn('min-w-0 flex-1 truncate text-xs', t.unread ? 'font-semibold' : 'font-medium')}>{t.subject}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(t.lastMessageAt)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusBadge status={t.status} />
                    {t.preview && <span className="truncate text-[11px] text-muted-foreground">{t.preview}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Link href="/client/support" className="mt-3 block text-center text-[11px] font-medium text-primary hover:underline">
          See all conversations
        </Link>
      </div>
    </div>
  )
}

/** Short form for the widget: topic + message; the subject comes from the message's first line. */
function QuickStart({ onCreated }: { onCreated: (ticketId: string) => void }) {
  const [category, setCategory] = useState<SupportCategory>('technical')
  const [message, setMessage] = useState('')
  const [clientMsgId] = useState(newClientMsgId)
  const create = useCreateTicket()
  const trimmed = message.trim()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!trimmed) return
    const firstLine = trimmed.split('\n')[0].trim()
    const subject = firstLine.length >= 3 ? (firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine) : `${CATEGORY_LABELS[category]} question`
    create.mutate(
      { subject, category, message: trimmed, clientMsgId, source: 'widget' },
      {
        onSuccess: ({ ticketId }) => onCreated(ticketId),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="space-y-1">
        <label htmlFor="widget-topic" className="text-[11px] font-medium">Topic</label>
        <Select value={category} onValueChange={(v) => setCategory(v as SupportCategory)}>
          <SelectTrigger id="widget-topic" className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CUSTOMER_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">{CATEGORY_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-h-0 flex-1 flex-col space-y-1">
        <label htmlFor="widget-message" className="text-[11px] font-medium">How can we help?</label>
        <textarea
          id="widget-message"
          value={message}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe the problem. You can attach screenshots once the conversation starts."
          className="min-h-[140px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          autoFocus
        />
      </div>
      <button
        type="submit"
        disabled={!trimmed || create.isPending}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        Send
      </button>
    </form>
  )
}
