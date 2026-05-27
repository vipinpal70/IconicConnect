"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Send, Paperclip, FileText, Loader2, Download } from "lucide-react"
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
}

interface Props {
  caseId: string
  side: "lab" | "admin"
  className?: string
  heightClass?: string
}

export function CaseChat({ caseId, side, className, heightClass = "h-[500px]" }: Props) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const [currentId, setCurrentId] = useState(caseId)
  if (currentId !== caseId) {
    setCurrentId(caseId)
    setMessages(null)
  }

  // 1. Fetch case messages
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/chat`)
      if (!res.ok) throw new Error("Failed to load chat messages")
      const json = await res.json()
      setMessages(json.data || [])
    } catch {
      toast.error("Failed to load messages")
    }
  }, [caseId])

  // Reset messages to null on caseId change to show loading skeleton
  useEffect(() => {
    const t = setTimeout(() => {
      fetchMessages()
    }, 0)
    // Poll for new messages every 8 seconds for a lively chat experience
    const interval = setInterval(fetchMessages, 8000)
    return () => {
      clearTimeout(t)
      clearInterval(interval)
    }
  }, [caseId, fetchMessages])

  // Mark chat notifications for this case as read when chat is opened/loaded
  useEffect(() => {
    const clearChatNotifications = async () => {
      try {
        const notifRes = await fetch("/api/notifications");
        if (!notifRes.ok) return;
        const notifJson = await notifRes.json();
        const unreadChatNotifs = (notifJson.data || []).filter(
          (n: any) => !n.read && n.type === "chat_message" && n.link?.includes(caseId)
        );
        for (const notif of unreadChatNotifs) {
          await fetch(`/api/notifications/${notif.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ read: true }),
          });
        }
      } catch (err) {
        console.error("Failed to clear chat notifications", err);
      }
    };
    clearChatNotifications();
  }, [caseId, messages]);

  // Scroll to bottom of the chat container whenever messages load or change
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [messages])

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
    if (!trimmed) return

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
    }
  }

  // 4. File selection and upload constraints
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (side !== "lab") {
      toast.error("Admins and QC operators can only send text messages.")
      return
    }

    const maxLimit = 500 * 1024 * 1024 // 500MB
    if (file.size > maxLimit) {
      toast.error("File size exceeds the 500MB chat message upload limit.")
      return
    }

    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase()
    const allowedExtensions = [
      ".png", ".jpg", ".jpeg",
      ".mp4", ".mkv", ".avi", ".mov", ".webm",
      ".pdf",
      ".zip",
      ".doc", ".docx"
    ]
    if (!allowedExtensions.includes(ext)) {
      toast.error("Unsupported type. Allowed: PNG, JPG, JPEG, MP4/Video, PDF, ZIP, DOC, DOCX")
      return
    }

    setUploading(true)
    setUploadProgress(0)

    try {
      const xhr = new XMLHttpRequest()
      xhr.open("POST", `/api/cases/upload?fileName=${encodeURIComponent(file.name)}`, true)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100)
          setUploadProgress(percent)
        }
      }

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const uploadRes = JSON.parse(xhr.responseText)
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
        } else {
          const err = JSON.parse(xhr.responseText || "{}")
          toast.error(err.error || "Failed to upload file")
        }
        setUploading(false)
      }

      xhr.onerror = () => {
        toast.error("Connection error during upload")
        setUploading(false)
      }

      xhr.send(file)
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
  const sortedMessages = messages ? [...messages].reverse() : null

  return (
    <div className={cn("flex flex-col rounded-lg border border-border bg-card overflow-hidden shadow-sm", className)}>
      <div ref={scrollContainerRef} className={cn("flex-1 overflow-y-auto p-3 space-y-2 bg-muted/15 flex flex-col", heightClass)}>
        {sortedMessages === null ? (
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
            {sortedMessages.map((m) => {
              const isAdminColumn = ["admin", "qc", "designer"].includes(m.senderRole)
              const alignment = isAdminColumn ? "justify-end" : "justify-start"

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
                        "text-[9px] font-bold uppercase tracking-wide",
                        isAdminColumn ? "text-zinc-200" : "text-emerald-700"
                      )}>
                        {m.senderName} ({m.senderRole === "qc" ? "QC Lead" : m.senderRole})
                      </span>
                    </div>

                    <p className="text-xs leading-normal whitespace-pre-wrap wrap-break-words">{m.messageText}</p>

                    {renderFilePreview(m)}

                    <span className={cn(
                      "block text-[8px] mt-1 text-right",
                      isAdminColumn ? "text-zinc-300" : "text-muted-foreground"
                    )}>
                      {new Date(m.createdAt).toLocaleDateString()} {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
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

      <div className="flex gap-1.5 p-2 border-t border-border bg-card items-center">
        {side === "lab" && (
          <>
            <input 
              type="file" 
              className="hidden" 
              onChange={handleFileChange}
              id="chat-file-input"
              accept=".png,.jpg,.jpeg,.mp4,.mkv,.avi,.mov,.webm,.pdf,.zip,.doc,.docx"
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
          </>
        )}

        <Input
          placeholder="Type a message…"
          value={text}
          disabled={uploading}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          className="bg-muted/10 h-8 text-xs"
        />

        <Button 
          onClick={handleSend} 
          disabled={!text.trim() || uploading} 
          size="icon"
          className="h-8 w-8 shrink-0"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
