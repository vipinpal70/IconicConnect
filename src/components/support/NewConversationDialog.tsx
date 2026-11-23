'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Paperclip } from 'lucide-react'
import { ACCEPT_ATTRIBUTE } from '@/src/lib/support/upload-policy'
import { UploadTiles } from './Attachments'
import { useUploads } from './useUploads'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/src/components/ui/dialog'
import { Input } from '@/src/components/ui/input'
import { Label } from '@/src/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select'
import { Textarea } from '@/src/components/ui/textarea'
import {
  CATEGORY_LABELS,
  CUSTOMER_CATEGORIES,
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  PRIORITY_LABELS,
  SUPPORT_PRIORITIES,
  type SupportCategory,
  type SupportPriority,
} from '@/src/lib/support/constants'
import { newClientMsgId, useCreateTicket, useLabs } from './api'

interface NewConversationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'customer' | 'agent'
  initialSubject?: string
  onCreated: (ticketId: string) => void
}

/** Start a conversation: labs describe their issue; agents open one on a lab's behalf. */
export function NewConversationDialog({ open, onOpenChange, mode, initialSubject = '', onCreated }: NewConversationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remount per opening so the form starts fresh (and picks up a follow-up subject) */}
        {open && <ConversationForm mode={mode} initialSubject={initialSubject} onCreated={onCreated} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ConversationForm({
  mode,
  initialSubject,
  onCreated,
  onCancel,
}: {
  mode: 'customer' | 'agent'
  initialSubject: string
  onCreated: (ticketId: string) => void
  onCancel: () => void
}) {
  const agent = mode === 'agent'
  const [subject, setSubject] = useState(initialSubject ? `Follow-up: ${initialSubject}`.slice(0, MAX_SUBJECT_LENGTH) : '')
  const [category, setCategory] = useState<SupportCategory>('technical')
  const [priority, setPriority] = useState<SupportPriority>('normal')
  const [clientId, setClientId] = useState('')
  const [message, setMessage] = useState('')
  // One id per form: a double submit can't create two conversations
  const [clientMsgId] = useState(newClientMsgId)
  const labs = useLabs(agent)
  const create = useCreateTicket()
  // Labs can attach files to their first message (agents attach in the thread, once the lab is chosen)
  const uploads = useUploads()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const valid =
    subject.trim().length >= 3 && message.trim().length > 0 && (!agent || clientId) && !uploads.uploading && !uploads.failed

  const cancel = () => {
    uploads.items.forEach((item) => uploads.remove(item.localId))
    onCancel()
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    create.mutate(
      {
        subject: subject.trim(),
        category,
        message: message.trim(),
        clientMsgId,
        ...(agent ? { clientId, priority } : { source: 'page' as const, attachmentIds: uploads.readyIds }),
      },
      {
        onSuccess: ({ ticketId }) => {
          toast.success(agent ? 'Conversation started' : 'Sent. Our team will reply here.')
          onCreated(ticketId)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <DialogHeader>
        <DialogTitle className="text-sm">{agent ? 'Start a conversation with a lab' : 'New conversation'}</DialogTitle>
        <DialogDescription className="text-xs">
          {agent
            ? 'The lab is notified and the conversation is assigned to you.'
            : 'Tell us what happened. Include case numbers or file names if they help.'}
        </DialogDescription>
      </DialogHeader>

      {agent && (
        <div className="space-y-1.5">
          <Label htmlFor="sup-lab" className="text-xs">Lab</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="sup-lab" className="h-9 text-xs">
              <SelectValue placeholder={labs.isLoading ? 'Loading labs…' : 'Choose a lab'} />
            </SelectTrigger>
            <SelectContent>
              {(labs.data ?? []).map((l) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="sup-subject" className="text-xs">Subject</Label>
        <Input
          id="sup-subject"
          value={subject}
          maxLength={MAX_SUBJECT_LENGTH}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={agent ? 'What is this about?' : 'Short summary, e.g. "Scan upload stops at 80%"'}
          className="h-9 text-xs"
          autoFocus
        />
      </div>

      <div className={agent ? 'grid grid-cols-2 gap-3' : ''}>
        <div className="space-y-1.5">
          <Label htmlFor="sup-category" className="text-xs">Topic</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as SupportCategory)}>
            <SelectTrigger id="sup-category" className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">{CATEGORY_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {agent && (
          <div className="space-y-1.5">
            <Label htmlFor="sup-priority" className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as SupportPriority)}>
              <SelectTrigger id="sup-priority" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORT_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">{PRIORITY_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sup-message" className="text-xs">Message</Label>
        <Textarea
          id="sup-message"
          value={message}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={6}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={agent ? 'First message to the lab' : 'What happened, when, and what you expected to see'}
          className="text-xs"
          onPaste={(e) => {
            if (agent) return
            const pasted = Array.from(e.clipboardData.files)
            if (pasted.length > 0) {
              e.preventDefault()
              uploads.add(pasted)
            }
          }}
        />
      </div>

      {!agent && (
        <div>
          <UploadTiles items={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) uploads.add(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden /> Attach screenshots or files
          </button>
          <p className="mt-1 text-[10px] text-muted-foreground">Images, videos, PDFs or documents · up to 500 MB each · you can also paste a screenshot</p>
        </div>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <button type="button" onClick={cancel} className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || create.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {(create.isPending || uploads.uploading) && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {uploads.uploading ? 'Uploading…' : agent ? 'Start conversation' : 'Send'}
        </button>
      </DialogFooter>
    </form>
  )
}
