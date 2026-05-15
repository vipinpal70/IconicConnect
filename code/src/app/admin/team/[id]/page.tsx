"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import {
  ArrowLeft, Save, Shield, Mail, Phone,
  User, Briefcase, Calendar, CheckCircle2, AlertCircle
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { toast } from "sonner"
import { useParams, useRouter } from "next/navigation"

const ROLES = [
  { id: 'admin', name: 'Admin' },
  { id: 'qc', name: 'QC' },
  { id: 'account_manager', name: 'Account Manager' },
  { id: 'designer', name: 'Designer' },
]

export default function MemberDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const id = params.id as string

  const { data: currentUser, isLoading: isUserLoading, error: userError } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/admin/me')
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.push('/auth/sign-in')
          throw new Error('Unauthorized')
        }
        throw new Error(errData.details || errData.error || 'Failed to fetch current user')
      }
      return res.json()
    }
  })

  const { data: member, isLoading: isMemberLoading, error: memberError } = useQuery({
    queryKey: ['member', id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/members/${id}`)
      if (!res.ok) throw new Error('Failed to fetch member')
      return res.json()
    },
    enabled: !!currentUser && (currentUser.role === 'admin' || currentUser.id === id)
  })

  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin' && currentUser.id !== id) {
      router.push(`/admin/team/${currentUser.id}`)
      toast.error('You do not have permission to view this profile')
    }
  }, [currentUser, id, router])

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    role: '',
    status: '',
    phone: '',
    title: '',
    userType: '',
  })

  useEffect(() => {
    if (member) {
      setFormData({
        fullName: member.fullName || '',
        email: member.email || '',
        role: member.role || '',
        status: member.status || '',
        phone: member.phone || '',
        title: member.title || '',
        userType: member.userType || '',
      })
    }
  }, [member])

  const mutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch(`/api/admin/members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update member')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Member profile updated')
      queryClient.invalidateQueries({ queryKey: ['member', id] })
      queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const handleRoleChange = (role: string) => {
    // All team members are now admin_portal users
    setFormData(prev => ({ ...prev, role, userType: 'admin_portal' }))
  }

  const isInitialLoading = isUserLoading || isMemberLoading
  const anyError = userError || memberError

  if (isInitialLoading) return <AdminLayout><div className="p-8 text-center">Loading...</div></AdminLayout>
  if (anyError) return <AdminLayout><div className="p-8 text-center text-red-500">Error: {(anyError as Error).message}</div></AdminLayout>
  if (!member) return <AdminLayout><div className="p-8 text-center">Member not found</div></AdminLayout>

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
        <div className="flex items-center justify-between">
          {currentUser?.role === 'admin' ? (
            <Button variant="ghost" className="gap-2 -ml-2 text-muted-foreground" onClick={() => router.push('/admin/team')}>
              <ArrowLeft className="w-4 h-4" />
              Back to Team
            </Button>
          ) : (
            <div className="h-9" /> // Spacer
          )}
          <div className="flex items-center gap-2">
            <Button onClick={() => mutation.mutate(formData)} disabled={mutation.isPending} className="gap-2">
              {mutation.isPending ? 'Saving...' : <><Save className="w-4 h-4" /> Save Changes</>}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar Info */}
          <div className="lg:col-span-1 space-y-6">
            <Card className="border-border/50 shadow-card">
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className={`w-24 h-24 rounded-2xl flex items-center justify-center font-bold text-2xl mb-4 ${formData.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {formData.fullName?.slice(0, 2).toUpperCase() || '??'}
                  </div>
                  <h2 className="text-xl font-bold">{formData.fullName || 'Unknown Member'}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{formData.email}</p>
                  <div className="flex items-center gap-2 mt-4">
                    <Badge variant={formData.status === 'active' ? 'default' : 'secondary'} className={formData.status === 'active' ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20' : ''}>
                      {formData.status === 'active' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                      {formData.status.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      <Shield className="w-3 h-3 mr-1" />
                      {formData.role.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                </div>

                <div className="mt-8 space-y-4 pt-6 border-t border-border/50">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2"><Calendar className="w-4 h-4" /> Joined</span>
                    <span className="font-medium">{new Date(member.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2"><User className="w-4 h-4" /> User Type</span>
                    <span className="font-medium capitalize">{formData.userType.replace(/_/g, ' ')}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-border/50 shadow-card">
              <CardHeader>
                <CardTitle>Profile Details</CardTitle>
                <CardDescription>Update member personal information and organization settings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={formData.fullName}
                        onChange={e => setFormData(p => ({ ...p, fullName: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={formData.email}
                        readOnly // Email usually restricted from change
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Job Title</Label>
                    <div className="relative">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="e.g. Senior QC"
                        value={formData.title}
                        onChange={e => setFormData(p => ({ ...p, title: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="+1 (555) 000-0000"
                        value={formData.phone}
                        onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <h3 className="text-sm font-semibold mb-4">Organization Settings</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select
                        onValueChange={handleRoleChange}
                        value={formData.role}
                        disabled={currentUser?.role !== 'admin'}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 text-slate-50 border-slate-800 shadow-2xl">
                          {ROLES.map(r => (
                            <SelectItem key={r.id} value={r.id} className="focus:bg-slate-800 focus:text-slate-50">
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        onValueChange={val => setFormData(p => ({ ...p, status: val }))}
                        value={formData.status}
                        disabled={currentUser?.role !== 'admin'}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 text-slate-50 border-slate-800 shadow-2xl">
                          <SelectItem value="active" className="focus:bg-slate-800 focus:text-slate-50">Active</SelectItem>
                          <SelectItem value="inactive" className="focus:bg-slate-800 focus:text-slate-50">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-card border-dashed bg-muted/20">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-xl shadow-sm border border-border/50">
                    <Shield className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold">Security & Access</h4>
                    <p className="text-sm text-muted-foreground">The user has access based on the assigned role. Changing the role will immediately update their permissions.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
