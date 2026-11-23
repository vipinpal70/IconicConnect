'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { CATEGORY_LABELS } from '@/src/lib/support/constants'
import { cn } from '@/src/lib/utils'
import { MessageList, type PendingMessage } from './MessageList'
import { Composer } from './Composer'
import { AgentControls } from './AgentControls'
import { ApiError, newClientMsgId, sendMessage, supportKeys, useMarkRead, useThreadMessages, useTicket, useTicketAction } from './api'
import { PriorityLabel, StatusBadge, WaitingBadge } from './parts'
import { useUploads } from './useUploads'
import { useTypingNames, useTypingSender } from './live'

interface ThreadViewProps {
  ticketId: string
  /** Mobile: back to the list. */
  onBack: () => void
  /** Customers: start a follow-up after the reopen window has passed. */
  onStartFollowUp?: (subject: string) => void
  /** Floating widget: tighter header, back button always visible. */
  compact?: boolean
}

export function ThreadView({ ticketId, onBack, onStartFollowUp, compact = false }: ThreadViewProps) {
  const queryClient = useQueryClient()
  const ticketQuery = useTicket(ticketId)
  const thread = useThreadMessages(ticketId)
  const action = useTicketAction(ticketId)
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [dragging, setDragging] = useState(false)
  const uploads = useUploads(ticketId)
  const sendTyping = useTypingSender(ticketId)
  const typingNames = useTypingNames(ticketId, ticketQuery.data?.viewerId ?? '')

  const ticket = ticketQuery.data
  const messages = thread.data?.messages ?? []
  useMarkRead(ticketId, messages.at(-1)?.seq)

  const deliver = async (item: PendingMessage) => {
    try {
      const { message } = await sendMessage(ticketId, item.body, item.visibility, item.clientMsgId, item.attachmentIds)
      // Fetch before adding: a reopen inserts a system line just before this message, and fetching
      // "everything after our last message" must not skip it
      await thread.fetchNewer().catch(() => null)
      thread.addMessage(message)
      setPending((list) => list.filter((p) => p.clientMsgId !== item.clientMsgId))
      // A reply can change the status (New → Live, reopen)
      void queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) })
      void queryClient.invalidateQueries({ queryKey: supportKeys.lists })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Not sent'
      setPending((list) => list.map((p) => (p.clientMsgId === item.clientMsgId ? { ...p, status: 'failed', error: message } : p)))
      if (error instanceof ApiError && error.code === 'closed') {
        void queryClient.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) })
        toast.error(error.message)
      }
    }
  }

  const send = (body: string, visibility: 'public' | 'note', attachmentIds: string[]) => {
    const attachmentNames = uploads.items.filter((i) => i.attachmentId && attachmentIds.includes(i.attachmentId)).map((i) => i.name)
    const item: PendingMessage = {
      clientMsgId: newClientMsgId(),
      body,
      visibility,
      attachmentIds,
      attachmentNames,
      status: 'sending',
      createdAt: new Date().toISOString(),
    }
    setPending((list) => [...list, item])
    void deliver(item)
  }

  const retry = (clientMsgId: string) => {
    const item = pending.find((p) => p.clientMsgId === clientMsgId)
    if (!item) return
    const again = { ...item, status: 'sending' as const, error: undefined }
    setPending((list) => list.map((p) => (p.clientMsgId === clientMsgId ? again : p)))
    void deliver(again) // same clientMsgId: the server never stores it twice
  }

  if (ticketQuery.isLoading || thread.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading conversation" />
      </div>
    )
  }

  if (ticketQuery.error || !ticket) {
    const notFound = ticketQuery.error instanceof ApiError && ticketQuery.error.status === 404
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <p>{notFound ? 'This conversation does not exist or you do not have access to it.' : ticketQuery.error?.message}</p>
        <button type="button" onClick={onBack} className="font-medium text-primary hover:underline">
          Back to conversations
        </button>
      </div>
    )
  }

  const agentView = ticket.viewerSide === 'agent'
  const closed = ticket.status === 'closed'
  const canReopen = ticket.actions.includes('reopen')
  const canCompose = !(closed && !agentView && !canReopen)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col"
      aria-label={`Conversation ${ticket.number}`}
      // Drop files anywhere on the conversation to attach them
      onDragOver={(e) => {
        if (!canCompose || !hasFiles(e)) return
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragging(false)
      }}
      onDrop={(e) => {
        if (!canCompose || !hasFiles(e)) return
        e.preventDefault()
        setDragging(false)
        uploads.add(e.dataTransfer.files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 text-xs font-medium text-primary">
          Drop files to attach (up to 500 MB each)
        </div>
      )}
      <header className={cn('flex items-start gap-2 border-b border-border/60 px-3 py-2.5', !compact && 'sm:px-5')}>
        <button
          type="button"
          onClick={onBack}
          className={cn('mt-0.5 rounded p-1 text-muted-foreground hover:bg-muted', !compact && 'lg:hidden')}
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{ticket.subject}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="font-mono">{ticket.number}</span>
            {ticket.legacyNumber && !compact && <span className="font-mono">(was {ticket.legacyNumber})</span>}
            <StatusBadge status={ticket.status} />
            <WaitingBadge status={ticket.status} lastPublicSender={ticket.lastPublicSender} viewerSide={ticket.viewerSide} />
            <span>· {CATEGORY_LABELS[ticket.category]}</span>
            {agentView && <PriorityLabel priority={ticket.priority} />}
            {agentView && <span>· {ticket.lab.name}</span>}
            {!agentView && ticket.assignee && <span>· Handled by {ticket.assignee.name}</span>}
          </div>
        </div>
        {!agentView && ticket.actions.includes('close') && (
          <button
            type="button"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({ action: 'close' }, { onError: (e) => toast.error(e.message), onSuccess: () => toast.success('Conversation closed') })
            }
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            Mark as solved
          </button>
        )}
      </header>

      {agentView && <AgentControls ticket={ticket} />}

      <MessageList
        messages={messages}
        pending={pending}
        viewerId={ticket.viewerId}
        viewerSide={ticket.viewerSide}
        otherSideReadSeq={ticket.otherSideReadSeq}
        hasMoreBefore={thread.data?.hasMoreBefore ?? false}
        onLoadOlder={thread.loadOlder}
        onRetry={retry}
      />

      <p className="h-5 px-4 text-[11px] text-muted-foreground" aria-live="polite">
        {typingNames.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground" />
            </span>
            {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.join(' and ')} are typing…`}
          </span>
        )}
      </p>

      {!canCompose ? (
        <div className="border-t border-border/60 bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          <p>This conversation is closed.</p>
          {onStartFollowUp && (
            <button
              type="button"
              onClick={() => onStartFollowUp(ticket.subject)}
              className="mt-2 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Start a new conversation
            </button>
          )}
        </div>
      ) : (
        <>
          {closed && (
            <p className="border-t border-border/60 bg-muted/30 px-4 py-2 text-center text-[11px] text-muted-foreground">
              {agentView
                ? 'Closed. Replying will reopen it for the lab.'
                : `Closed. Reply${ticket.reopenUntil ? ` before ${format(new Date(ticket.reopenUntil), 'd MMM')}` : ''} to reopen it.`}
            </p>
          )}
          <Composer
            onSend={send}
            uploads={uploads}
            onTyping={sendTyping}
            allowNotes={agentView}
            placeholder={agentView ? `Reply to ${ticket.lab.name}` : 'Write a message to support'}
          />
        </>
      )}
    </section>
  )
}
