"use client"

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useVisibleInterval } from "@/src/hooks/useVisibleInterval"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { uploadFileInChunks } from "@/src/lib/upload-utils"
import { CaseChatEditor, CaseChatMessageActions } from "@/src/components/CaseChatMessageActions"
import { Send, Paperclip, FileText, Loader2, Download, Ban } from "lucide-react"
import { cn } from "@/src/lib/utils"
import { toast } from "sonner"

interface ChatMessage {
  id: string
  caseId: string
  senderId: string
  senderRole: string
  senderName: string
  messageText: string
  fileUrl?: string | null
  fileName?: string | null
  fileType?: string | null
  fileSize?: string | null
  createdAt: string
  editedAt?: string | null
  mine?: boolean
  deleted?: boolean
  /** The viewer may edit / delete this message for `msLeft` more milliseconds (measured by the server). */
  canEdit?: boolean
  canDelete?: boolean
  msLeft?: number
  /** When that ends on this computer's clock: set when the message is received. */
  deadline?: number
}

const POLL_MS = 8000

/** Newest first; a changed message replaces the copy already shown. */
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

interface Props {
  caseId: string
  /** The case's owning client — required so admin/QC/designer uploads are stored under the
   * client's own lab namespace instead of the uploader's (which would 404/403 for the client). */
  clientId?: string | null
  className?: string
  heightClass?: string
  disabled?: boolean
}

export function CaseChat({ caseId, clientId, className, heightClass = "h-[500px]", disabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [text, setText] = useState("")
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const queryClient = useQueryClient()

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Bumped by every change, so a poll that started before an edit can't bring the old text back
  const versionRef = useRef(0)
  // Where the next "what changed?" starts; null = load the newest page
  const cursorRef = useRef<string | null>(null)
  const markedRef = useRef<string | null>(null)
  // Distance from the bottom to restore after older messages are added above
  const keepFromBottomRef = useRef<number | null>(null)

  // Reset state when the caseId prop changes — useEffect avoids the render-time setState anti-pattern
  useEffect(() => {
    versionRef.current++
    cursorRef.current = null
    markedRef.current = null
    setMessages(null)
    setHasOlder(false)
    setForbidden(false)
    setEditingId(null)
  }, [caseId])

  // 1. The newest messages at first, then only what changed
  const fetchMessages = useCallback(async () => {
    const version = versionRef.current
    const since = cursorRef.current
    try {
      const res = await fetch(`/api/cases/${caseId}/chat${since ? `?since=${since}` : ""}`)
      if (version !== versionRef.current) return
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) throw new Error("Failed to load chat messages")
      const json = await res.json()
      if (version !== versionRef.current) return
      const receivedAt = Date.now()
      const incoming = ((json.data || []) as ChatMessage[]).map((m) => ({ ...m, deadline: receivedAt + (m.msLeft ?? 0) }))
      cursorRef.current = json.cursor ?? null
      if (json.changes) {
        if (incoming.length === 0) return // nothing new: no re-render
        setNow(receivedAt)
        setMessages((current) => mergeMessages(current ?? [], incoming))
      } else {
        setNow(receivedAt)
        setMessages(incoming)
        setHasOlder(Boolean(json.hasMore))
      }
    } catch {
      // Once the chat is on screen, a missed refresh isn't worth a message every 8 seconds
      if (!since) toast.error("Failed to load messages")
    }
  }, [caseId])

  useEffect(() => {
    if (forbidden) return
    const t = setTimeout(() => void fetchMessages(), 0)
    return () => clearTimeout(t)
  }, [fetchMessages, forbidden])

  // Only while the tab is visible; at once when it is shown again
  useVisibleInterval(() => void fetchMessages(), POLL_MS, !forbidden)

  const loadOlder = async () => {
    const oldest = messages?.[messages.length - 1]
    if (!oldest || loadingOlder) return
    const version = versionRef.current
    setLoadingOlder(true)
    try {
      const res = await fetch(`/api/cases/${caseId}/chat?before=${oldest.id}`)
      if (!res.ok) throw new Error()
      const json = await res.json()
      if (version !== versionRef.current) return
      const box = scrollContainerRef.current
      keepFromBottomRef.current = box ? box.scrollHeight - box.scrollTop : null
      setMessages((current) => mergeMessages(json.data as ChatMessage[], current ?? []))
      setHasOlder(Boolean(json.hasMore))
    } catch {
      toast.error("Failed to load earlier messages")
    } finally {
      setLoadingOlder(false)
    }
  }

  // Adding messages above must not move what the person is reading
  useLayoutEffect(() => {
    const box = scrollContainerRef.current
    if (!box || keepFromBottomRef.current === null) return
    box.scrollTop = box.scrollHeight - keepFromBottomRef.current
    keepFromBottomRef.current = null
  }, [messages])

  // Seen: only while the chat is really on screen, and only when there is something newer
  const newest = messages?.[0]
  const newestMine = newest?.mine
  useEffect(() => {
    const id = newest?.id
    if (!id || newestMine) return // sending already marks one's own message
    const mark = () => {
      if (document.visibilityState !== "visible" || markedRef.current === id) return
      markedRef.current = id
      fetch(`/api/cases/${caseId}/chat/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error()
          if ((await res.json()).notificationsRead > 0) {
            for (const key of ["sidebar-badges", "notifications", "notifications-unread-count"]) {
              void queryClient.invalidateQueries({ queryKey: [key] })
            }
          }
        })
        .catch(() => {
          if (markedRef.current === id) markedRef.current = null // tried again when the tab is next shown
        })
    }
    mark()
    document.addEventListener("visibilitychange", mark)
    return () => document.removeEventListener("visibilitychange", mark)
  }, [caseId, newest?.id, newestMine, queryClient])

  // Scroll to the bottom when a new message arrives (not on every refresh: that would pull the view away
  // from a message being edited)
  const newestId = messages?.[0]?.id
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [newestId])

  // Count down only while one of the viewer's messages can still be changed
  const lastDeadline = Math.max(0, ...(messages ?? []).filter((m) => m.canDelete).map((m) => m.deadline ?? 0))
  useEffect(() => {
    if (lastDeadline <= Date.now()) return
    const t = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= lastDeadline) clearInterval(t)
    }, 1000)
    return () => clearInterval(t)
  }, [lastDeadline])

  /** Edit or delete one of the viewer's messages. Resolves true when the server accepted it. */
  const changeMessage = async (messageId: string, init: RequestInit): Promise<boolean> => {
    setBusyId(messageId)
    versionRef.current++
    try {
      const res = await fetch(`/api/cases/${caseId}/chat/${messageId}`, init)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to change the message")
      }
      return true
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to change the message")
      return false
    } finally {
      versionRef.current++
      await fetchMessages()
      setBusyId(null)
    }
  }

  const saveEdit = async (messageId: string, messageText: string) => {
    const saved = await changeMessage(messageId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageText }),
    })
    // On failure the editor stays open, so what was typed isn't lost
    if (saved) closeEditor()
  }

  const closeEditor = () => {
    setEditingId(null)
    inputRef.current?.focus()
  }

  const deleteMessage = async (messageId: string) => {
    if (await changeMessage(messageId, { method: "DELETE" })) inputRef.current?.focus()
  }

  // 2. Format file sizes nicely
  const formatSize = (bytesStr?: string | null) => {
    if (!bytesStr) return ""
    const bytes = Number(bytesStr)
    if (isNaN(bytes)) return ""
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // 3. Send Text Message
  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    try {
      const res = await fetch(`/api/cases/${caseId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageText: trimmed }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to send message")
      }
      setText("")
      await fetchMessages()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to send message")
    } finally {
      setSending(false)
    }
  }

  // 4. File selection and upload constraints
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const maxLimit = 500 * 1024 * 1024 // 500MB
    if (file.size > maxLimit) {
      toast.error("File size exceeds the 500MB chat message upload limit.")
      return
    }

    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase()
    const allowedExtensions = [
      ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".svg", ".heic", ".heif", ".ico",
      ".mp4", ".mkv", ".avi", ".mov", ".webm",
      ".pdf",
      ".zip",
      ".doc", ".docx"
    ]
    if (!allowedExtensions.includes(ext)) {
      toast.error("Unsupported file type")
      return
    }

    setUploading(true)
    setUploadProgress(0)

    try {
      await uploadFileInChunks(
        file,
        { clientId },
        (percent) => {
          setUploadProgress(percent)
        },
        async (uploadRes) => {
          const msgPayload = {
            messageText: `Shared an attachment: ${file.name}`,
            fileUrl: uploadRes.fileUrl,
            fileName: uploadRes.fileName,
            fileType: file.type,
            fileSize: file.size,
          }

          const linkRes = await fetch(`/api/cases/${caseId}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(msgPayload),
          })

          if (linkRes.ok) {
            toast.success("Attachment sent successfully!")
            await fetchMessages()
          } else {
            const err = await linkRes.json()
            toast.error(err.error || "Failed to attach file to message")
          }
          setUploading(false)
        },
        (err) => {
          toast.error(err || "Failed to upload file")
          setUploading(false)
        }
      )
    } catch {
      toast.error("Upload error")
      setUploading(false)
    }
  }

  const renderFilePreview = (m: ChatMessage) => {
    if (!m.fileUrl) return null

    const type = m.fileType || ""
    if (type.startsWith("image/")) {
      return (
        <div className="relative mt-1.5 rounded-md overflow-hidden border border-border/60 bg-muted/20 max-w-200px">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={m.fileUrl}
            alt={m.fileName || "Image"}
            className="max-w-full max-h-140px object-cover hover:scale-105 transition-transform duration-200 cursor-pointer"
            onClick={() => window.open(m.fileUrl!, "_blank")}
          />
        </div>
      )
    }

    if (type.startsWith("video/")) {
      return (
        <div className="mt-1.5 rounded-md overflow-hidden border border-border/60 bg-black max-w-240px">
          <video src={m.fileUrl} controls className="w-full max-h-140px" />
        </div>
      )
    }

    // Default document render
    return (
      <a
        href={m.fileUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 p-2 mt-1.5 rounded-md bg-muted/60 border border-border/50 hover:bg-muted/80 transition-all text-11px truncate max-w-240px"
      >
        <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{m.fileName}</p>
          <p className="text-[9px] text-muted-foreground">{formatSize(m.fileSize)}</p>
        </div>
        <Download className="h-3.5 w-3.5 text-muted-foreground hover:text-emerald-600 transition-colors shrink-0" />
      </a>
    )
  }

  // Reverse timeline order (oldest at top, latest at bottom)
  const sortedMessages = useMemo(
    () => (messages ? [...messages].reverse() : null),
    [messages]
  )

  return (
    <div className={cn("flex flex-col rounded-lg border border-border bg-card overflow-hidden shadow-sm", className)}>
      <div ref={scrollContainerRef} className={cn("shrink-0 overflow-y-scroll p-3 space-y-2 bg-muted/15 flex flex-col custom-scrollbar", heightClass)}>
        {forbidden ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-20">
            <div className="p-3 rounded-full bg-muted/50">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p className="text-xs font-semibold text-foreground">Chat not accessible</p>
            <p className="text-[11px] text-muted-foreground text-center max-w-48">You are not a participant in this case and cannot view or send messages here.</p>
          </div>
        ) : sortedMessages === null ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            Loading conversations...
          </div>
        ) : sortedMessages.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-16 my-auto">
            No messages recorded. Start the conversation for this case below.
          </p>
        ) : (
          <div className="space-y-2">
            {hasOlder && (
              <div className="text-center">
                <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={loadingOlder} onClick={loadOlder}>
                  {loadingOlder && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
                  Load earlier messages
                </Button>
              </div>
            )}
            {sortedMessages.map((m) => {
              const isAdminColumn = ["admin", "qc", "designer", "account_manager"].includes(m.senderRole)
              const alignment = isAdminColumn ? "justify-end" : "justify-start"
              const timeLeft = m.canDelete ? Math.max(0, (m.deadline ?? 0) - now) : 0
              const isEditing = editingId === m.id && !m.deleted

              return (
                <div key={m.id} className={cn("flex w-full", alignment)}>
                  <div className={cn(
                    "max-w-[80%] md:max-w-[70%] rounded-xl py-1.5 px-3 shadow-sm relative group transition-all duration-150",
                    isAdminColumn
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-card text-foreground border border-border rounded-bl-sm"
                  )}>
                    <div className="flex items-center justify-between gap-4 mb-0.5">
                      <span className={cn(
                        "text-[9px] font-semibold capitalize tracking-wide",
                        isAdminColumn ? "text-zinc-200" : "text-emerald-700"
                      )}>
                        {m.senderName} ({m.senderRole === "qc" ? "QC Lead" : m.senderRole})
                      </span>
                    </div>

                    {m.deleted ? (
                      <p className="flex items-center gap-1.5 text-xs italic opacity-75">
                        <Ban className="h-3 w-3 shrink-0" aria-hidden />
                        This message was deleted
                      </p>
                    ) : isEditing ? (
                      <CaseChatEditor
                        initialText={m.messageText}
                        timeLeft={timeLeft}
                        saving={busyId === m.id}
                        onSave={(value) => saveEdit(m.id, value)}
                        onCancel={closeEditor}
                      />
                    ) : (
                      <p className="text-xs leading-normal whitespace-pre-wrap wrap-break-words">{m.messageText}</p>
                    )}

                    {renderFilePreview(m)}

                    <span className={cn(
                      "block text-[8px] mt-1 text-right",
                      isAdminColumn ? "text-zinc-300" : "text-muted-foreground"
                    )}>
                      {m.editedAt && !m.deleted && <span className="mr-1 italic">(edited)</span>}
                      {new Date(m.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>

                    {timeLeft > 0 && !isEditing && (
                      <CaseChatMessageActions
                        canEdit={Boolean(m.canEdit)}
                        timeLeft={timeLeft}
                        busy={busyId === m.id}
                        onEdit={() => setEditingId(m.id)}
                        onDelete={() => deleteMessage(m.id)}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {uploading && (
        <div className="px-3 py-1.5 border-t border-border bg-emerald-50/20 text-[11px] text-emerald-800 flex items-center gap-3 animate-pulse">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600 shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between font-medium mb-0.5">
              <span>Uploading attachment...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-emerald-100 h-1 rounded-full overflow-hidden">
              <div className="bg-emerald-600 h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      {forbidden ? null : disabled ? (
        <div className="p-3 text-center text-xs text-red-600 bg-red-50 border-t border-red-100 font-medium">
          Chat is disabled because this case has been rejected.
        </div>
      ) : (
        <div className="flex gap-1.5 p-2 border-t border-border bg-card items-center">
          <input
            type="file"
            className="hidden"
            onChange={handleFileChange}
            id="chat-file-input"
            accept=".png,.jpg,.jpeg,.mp4,.mkv,.avi,.mov,.webm,.pdf,.zip,.doc,.docx,.webp,.gif,.bmp,.tiff,.tif,.svg,.heic,.heif,.ico"
          />
          <Button
            size="icon"
            variant="outline"
            disabled={uploading}
            onClick={() => document.getElementById("chat-file-input")?.click()}
            title="Attach media files (images, video, zip, pdf, docs upto 500MB)"
            className="h-8 w-8 shrink-0 border-border hover:bg-muted"
          >
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>

          <Input
            ref={inputRef}
            aria-label="Message"
            placeholder="Type a message…"
            value={text}
            disabled={uploading || sending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !sending) { e.preventDefault(); handleSend(); } }}
            className="bg-muted/10 h-8 text-xs"
          />

          <Button
            onClick={handleSend}
            disabled={!text.trim() || uploading || sending}
            size="icon"
            className="h-8 w-8 shrink-0"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
