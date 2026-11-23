'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/src/components/ui/dialog'
import { Input } from '@/src/components/ui/input'
import { Label } from '@/src/components/ui/label'
import { Textarea } from '@/src/components/ui/textarea'
import type { CannedReply } from '@/src/lib/support/types'
import { useCannedReplies, useDeleteCannedReply, useSaveCannedReply } from './api'

/** Manage saved replies: your own, plus shared ones if you are an admin. */
export function CannedRepliesDialog({ open, onOpenChange, isAdmin }: { open: boolean; onOpenChange: (open: boolean) => void; isAdmin: boolean }) {
  const replies = useCannedReplies(open)
  const remove = useDeleteCannedReply()
  const [editing, setEditing] = useState<CannedReply | 'new' | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setEditing(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Saved replies</DialogTitle>
          <DialogDescription className="text-xs">
            Type <span className="font-mono">/</span> in a reply to insert one. Use {'{{name}}'}, {'{{lab}}'} and {'{{agent}}'} to fill in names automatically.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <ReplyForm reply={editing === 'new' ? null : editing} isAdmin={isAdmin} onDone={() => setEditing(null)} />
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> New saved reply
            </button>
            {replies.isLoading ? (
              <div className="h-24 animate-pulse rounded-md bg-muted/60" aria-busy="true" />
            ) : replies.error ? (
              <p role="alert" className="text-xs text-destructive">{replies.error.message}</p>
            ) : (replies.data ?? []).length === 0 ? (
              <p className="rounded-md bg-muted/40 p-4 text-center text-xs text-muted-foreground">No saved replies yet.</p>
            ) : (
              <ul className="max-h-[50vh] divide-y divide-border/60 overflow-y-auto rounded-md border border-border/60">
                {(replies.data ?? []).map((reply) => (
                  <li key={reply.id} className="flex items-start gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                        {reply.shortcut && <span className="font-mono text-primary">/{reply.shortcut}</span>}
                        {reply.title}
                        <span className="rounded bg-muted px-1 text-[9px] font-normal text-muted-foreground">{reply.shared ? 'Shared' : 'Only you'}</span>
                      </p>
                      <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[11px] text-muted-foreground">{reply.body}</p>
                    </div>
                    {reply.editable && (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => setEditing(reply)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${reply.title}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (!confirm(`Delete the saved reply "${reply.title}"?`)) return
                            remove.mutate(reply.id, { onError: (e) => toast.error(e.message), onSuccess: () => toast.success('Deleted') })
                          }}
                          className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          aria-label={`Delete ${reply.title}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReplyForm({ reply, isAdmin, onDone }: { reply: CannedReply | null; isAdmin: boolean; onDone: () => void }) {
  const [title, setTitle] = useState(reply?.title ?? '')
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? '')
  const [body, setBody] = useState(reply?.body ?? '')
  const [shared, setShared] = useState(reply?.shared ?? false)
  const save = useSaveCannedReply()
  const cleanShortcut = shortcut.trim().toLowerCase().replace(/^\//, '')
  const shortcutValid = cleanShortcut === '' || /^[a-z0-9][a-z0-9-]{0,39}$/.test(cleanShortcut)
  const valid = title.trim() && body.trim() && shortcutValid

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        save.mutate(
          { id: reply?.id, title: title.trim(), body: body.trim(), shortcut: cleanShortcut || null, ...(reply ? {} : { shared }) },
          { onSuccess: () => { toast.success('Saved'); onDone() }, onError: (error) => toast.error(error.message) },
        )
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <Label htmlFor="canned-title" className="text-xs">Title</Label>
          <Input id="canned-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="h-9 text-xs" autoFocus />
        </div>
        <div className="space-y-1">
          <Label htmlFor="canned-shortcut" className="text-xs">Shortcut</Label>
          <Input
            id="canned-shortcut"
            value={shortcut}
            maxLength={41}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="e.g. refund"
            className="h-9 font-mono text-xs"
            aria-invalid={!shortcutValid}
          />
        </div>
      </div>
      {!shortcutValid && <p className="text-[11px] text-destructive">Shortcuts use lowercase letters, digits and dashes.</p>}
      <div className="space-y-1">
        <Label htmlFor="canned-body" className="text-xs">Reply</Label>
        <Textarea id="canned-body" value={body} maxLength={5000} rows={7} onChange={(e) => setBody(e.target.value)} className="text-xs" />
      </div>
      {isAdmin && !reply && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Share with the whole support team
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted">Cancel</button>
        <button
          type="submit"
          disabled={!valid || save.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save
        </button>
      </div>
    </form>
  )
}
