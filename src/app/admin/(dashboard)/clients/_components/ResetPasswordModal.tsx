"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { KeyRound, RefreshCw, Eye, EyeOff } from "lucide-react"
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
    onSuccess: () => {
      toast.success("Password updated and emailed to the client!")
      setNewPassword("")
      onOpenChange(false)
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
      </DialogContent>
    </Dialog>
  )
}
