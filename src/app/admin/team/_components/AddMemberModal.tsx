"use client"

import * as React from "react"
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { UserPlus, Mail, Shield, Copy, CheckCircle2, RefreshCw, X, KeyRound } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"

const ROLES = [
  { id: 'admin', name: 'Admin' },
  { id: 'qc', name: 'QC' },
  { id: 'account_manager', name: 'Account Manager' },
  { id: 'designer', name: 'Designer' },
]

interface AddMemberModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddMemberModal({ open, onOpenChange }: AddMemberModalProps) {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    role: '',
    userType: '', // derived from role
  })
  const [generatedPass, setGeneratedPass] = useState<string | null>(null)

  // Derived userType based on role
  const handleRoleChange = (role: string) => {
    // All team members are now admin_portal users
    setFormData(prev => ({ ...prev, role, userType: 'admin_portal' }))
  }

  const mutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to add member')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Member added successfully!')
      setGeneratedPass(formData.password)
      queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.fullName || !formData.email || !formData.password || !formData.role) {
      toast.error('Please fill all fields')
      return
    }
    mutation.mutate(formData)
  }

  const generateRandomPassword = () => {
    const pass = Math.random().toString(36).slice(-10) + "!"
    setFormData(prev => ({ ...prev, password: pass }))
  }

  const resetForm = () => {
    setFormData({ fullName: '', email: '', password: '', role: '', userType: '' })
    setGeneratedPass(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!mutation.isPending) onOpenChange(val) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Add New Member
          </DialogTitle>
        </DialogHeader>

        {generatedPass ? (
          <div className="space-y-6 py-4">
            <div className="bg-primary/5 border border-primary/10 rounded-xl p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Member Onboarded!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Credentials have been sent to <span className="font-medium text-foreground">{formData.email}</span>
                </p>
              </div>
              <div className="bg-white border border-border rounded-lg p-3 flex items-center justify-between">
                <code className="text-sm font-mono font-bold text-primary">{generatedPass}</code>
                <Button variant="ghost" size="sm" onClick={() => {
                  navigator.clipboard.writeText(generatedPass)
                  toast.success('Password copied')
                }}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <Button className="w-full" onClick={resetForm}>Done</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                placeholder="e.g. John Doe"
                value={formData.fullName}
                onChange={e => setFormData(p => ({ ...p, fullName: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input
                type="email"
                placeholder="john@example.com"
                value={formData.email}
                onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select onValueChange={handleRoleChange} value={formData.role}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent className="bg-green-900 text-white shadow-2xl">
                    {ROLES.map(r => (
                      <SelectItem key={r.id} value={r.id} className="focus:bg-green-600 opacity-90 focus:text-slate-50">
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Password"
                    className="flex-1"
                    value={formData.password}
                    onChange={e => setFormData(p => ({ ...p, password: e.target.value }))}
                    required
                  />
                  <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={generateRandomPassword} title="Generate random password">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Adding...' : 'Add Member'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
