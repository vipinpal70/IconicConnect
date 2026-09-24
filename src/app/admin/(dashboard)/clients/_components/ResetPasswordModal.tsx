"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { KeyRound, RefreshCw, Eye, EyeOff, Copy, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"

interface Client {
  id: string
  labName: string | null
  email: string
}

interface ResetPasswordModalProps {
  client: Client | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ResetPasswordModal({ client, open, onOpenChange }: ResetPasswordModalProps) {
  const [newPassword, setNewPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  // Set only when the password change succeeded but the notification email
  // failed to queue — keeps the modal open with the password visible instead
  // of silently closing, since that would otherwise be the only place it
  // exists (the client has no other way to get it).
  const [emailFailed, setEmailFailed] = useState(false)

  const mutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch(`/api/admin/clients/${client?.id}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to reset password")
      }
      return res.json()
    },
    onSuccess: (data: { emailQueued?: boolean }) => {
      if (data.emailQueued === false) {
        setEmailFailed(true)
        toast.warning("Password updated, but the email couldn't be sent — share it manually.")
      } else {
        toast.success("Password updated and emailed to the client!")
        setNewPassword("")
        onOpenChange(false)
      }
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleReset = () => {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }
    mutation.mutate(newPassword)
  }

  const generatePassword = () => {
    setNewPassword(Math.random().toString(36).slice(-10) + "!")
  }

  const handleOpenChange = (next: boolean) => {
    if (mutation.isPending) return
    if (!next) {
      setNewPassword("")
      setShowPassword(false)
      setEmailFailed(false)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            Reset Client Password
          </DialogTitle>
        </DialogHeader>

        {emailFailed ? (
          <>
            <div className="py-4 space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  The password was updated, but we couldn&apos;t send the notification email to{" "}
                  <span className="font-medium">{client?.email}</span>. Share the password below with them directly.
                </p>
              </div>
              <div className="bg-muted border border-border rounded-lg p-2.5 flex items-center justify-between">
                <code className="text-sm font-mono font-bold text-primary">{newPassword}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(newPassword)
                    toast.success("Password copied")
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button className="w-full" onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs uppercase tracking-wider">Client</Label>
                <p className="font-medium">{client?.labName || "N/A"}</p>
                <p className="text-sm text-muted-foreground">{client?.email}</p>
              </div>

              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter or generate password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <Button variant="outline" size="icon" onClick={generatePassword} title="Generate random password">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-amber-600 font-medium mt-1 italic">
                  * Updating will email the new password to the client at {client?.email || "their email"}.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button onClick={handleReset} disabled={mutation.isPending || !newPassword}>
                {mutation.isPending ? "Updating..." : "Update & Notify"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
