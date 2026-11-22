'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/src/components/ui/dialog'
import { Input } from '@/src/components/ui/input'
import { Label } from '@/src/components/ui/label'
import { newClientMsgId, useCreateTicket } from './api'

/**
 * "Request a callback" (decision D8): opens a normal conversation in the "callback" category, so the
 * request is tracked, assigned and answered like any other conversation.
 */
export function CallbackDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (ticketId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <CallbackForm onCreated={onCreated} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CallbackForm({ onCreated, onCancel }: { onCreated: (ticketId: string) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState('')
  const [bestTime, setBestTime] = useState('')
  const [topic, setTopic] = useState('')
  const [clientMsgId] = useState(newClientMsgId)
  const create = useCreateTicket()
  const valid = /[0-9]{6,}/.test(phone.replace(/[\s()+-]/g, ''))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    const lines = [
      'Please call me back.',
      `Phone: ${phone.trim()}`,
      bestTime.trim() && `Best time: ${bestTime.trim()}`,
      topic.trim() && `About: ${topic.trim()}`,
    ].filter(Boolean)
    create.mutate(
      { subject: 'Callback request', category: 'callback', message: lines.join('\n'), clientMsgId, source: 'page' },
      {
        onSuccess: ({ ticketId }) => {
          toast.success('Callback requested. We will call you soon.')
          onCreated(ticketId)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <DialogHeader>
        <DialogTitle className="text-sm">Request a callback</DialogTitle>
        <DialogDescription className="text-xs">A member of our team will call you. You can follow up in the conversation it creates.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="cb-phone" className="text-xs">Phone number</Label>
        <Input id="cb-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" className="h-9 text-xs" autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cb-time" className="text-xs">Best time to call (optional)</Label>
        <Input id="cb-time" value={bestTime} maxLength={100} onChange={(e) => setBestTime(e.target.value)} placeholder="e.g. weekdays after 3 pm" className="h-9 text-xs" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cb-topic" className="text-xs">What is it about? (optional)</Label>
        <Input id="cb-topic" value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} className="h-9 text-xs" />
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || create.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Request callback
        </button>
      </DialogFooter>
    </form>
  )
}
