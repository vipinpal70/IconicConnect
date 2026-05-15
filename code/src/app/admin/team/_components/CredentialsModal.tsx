"use client"

import * as React from "react"
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { KeyRound, Copy, RefreshCw, X, Eye, EyeOff, Mail } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"

interface Member {
  id: string
  fullName: string | null
  email: string
}

interface CredentialsModalProps {
  member: Member | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CredentialsModal({ member, open, onOpenChange }: CredentialsModalProps) {
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const mutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch(`/api/admin/members/${member?.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update credentials')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Credentials updated and email sent!')
      setNewPassword('')
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleReset = () => {
    if (!newPassword) {
      toast.error('Please enter a new password')
      return
    }
    mutation.mutate(newPassword)
  }

  const generatePass = () => {
    setNewPassword(Math.random().toString(36).slice(-10) + "!")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            Manage Credentials
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Member</Label>
            <p className="font-medium">{member?.fullName || 'N/A'}</p>
            <p className="text-sm text-muted-foreground">{member?.email}</p>
          </div>

          <div className="space-y-2">
            <Label>New Password</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input 
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
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
              <Button variant="outline" size="icon" onClick={generatePass} title="Generate random">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[10px] text-amber-600 font-medium mt-1 italic">
              * Updating will send an automated email with the new credentials.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleReset} disabled={mutation.isPending}>
            {mutation.isPending ? 'Updating...' : 'Update & Notify'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
