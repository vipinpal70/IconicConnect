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
import { COUNTRY_CODES, formatPhoneForStorage, parseStoredPhone, validateNationalPhone } from "@/src/lib/phone"
import { toast } from "sonner"
import { useParams, useRouter } from "next/navigation"

const ROLES = [
  { id: 'admin', name: 'Admin' },
  { id: 'qc', name: 'QC' },
  { id: 'account_manager', name: 'Account Manager' },
  { id: 'designer', name: 'Designer' },
  { id: 'consultant', name: 'Consultant' },
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

  const mutation = useMutation({
    mutationFn: async (data: {
      fullName: string
      email: string
      role: string
      status: string
      phone: string
      title: string
      userType: string
      countryCode: string
    }) => {
      const fullPhone = formatPhoneForStorage(data.countryCode, data.phone)
      const res = await fetch(`/api/admin/members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, phone: fullPhone }),
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
          <div className="h-10" />
        </div>

        <MemberDetailForm
          key={member.id}
          member={member}
          currentUserRole={currentUser?.role}
          isSaving={mutation.isPending}
          onSave={(data) => mutation.mutate(data)}
        />
      </div>
    </AdminLayout>
  )
}

function MemberDetailForm({
  member,
  currentUserRole,
  isSaving,
  onSave,
}: {
  member: {
    id: string
    fullName?: string | null
    email: string
    role: string
    status: string
    phone?: string | null
    title?: string | null
    userType: string
    createdAt: string
  }
  currentUserRole?: string
  isSaving: boolean
  onSave: (data: {
    fullName: string
    email: string
    role: string
    status: string
    phone: string
    title: string
    userType: string
    countryCode: string
  }) => void
}) {
  const parsedPhone = parseStoredPhone(member.phone)
  const [formData, setFormData] = useState({
    fullName: member.fullName || '',
    email: member.email || '',
    role: member.role || '',
    status: member.status || '',
    phone: parsedPhone.nationalNumber,
    title: member.title || '',
    userType: member.userType || '',
  })
  const [countryCode, setCountryCode] = useState(parsedPhone.countryCode)

  const handleRoleChange = (role: string) => {
    setFormData((prev) => ({ ...prev, role, userType: 'admin_portal' }))
  }

  const handleSave = () => {
    const phoneError = validateNationalPhone(countryCode, formData.phone)
    if (phoneError) {
      toast.error(phoneError)
      return
    }

    onSave({ ...formData, countryCode })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-6">
        <Card className="border-border/50 shadow-card">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <div className={`w-24 h-24 rounded-2xl flex items-center justify-center font-semibold  text-lg mb-4 ${formData.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                {formData.fullName?.slice(0, 2).toUpperCase() || '??'}
              </div>
              <h2 className="text-lg font-medium ">{formData.fullName || 'Unknown Member'}</h2>
              <p className="text-xs text-muted-foreground mt-1">{formData.email}</p>
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
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-2"><Calendar className="w-4 h-4" /> Joined</span>
                <span className="font-medium">{new Date(member.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-2"><User className="w-4 h-4" /> User Type</span>
                <span className="font-medium capitalize">{formData.userType.replace(/_/g, ' ')}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <Card className="border-border/50 shadow-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg">Profile Details</CardTitle>
                <CardDescription className="text-xs">Update member personal information and organization settings.</CardDescription>
              </div>
              <Button onClick={handleSave} disabled={isSaving} className="gap-2 text-xs font-medium">
                {isSaving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Changes</>}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-xs">Full Name</Label>
                <div className="relative">
                  <Input className="text-xs" value={formData.fullName} onChange={e => setFormData(p => ({ ...p, fullName: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Email Address</Label>
                <div className="relative">
                  <Input className="text-xs" value={formData.email} readOnly />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Job Title</Label>
                <div className="relative">
                  <Input className="text-xs" placeholder="e.g. Senior QC" value={formData.title} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Phone Number</Label>
                <div className="flex gap-2">
                  <select value={countryCode} onChange={e => setCountryCode(e.target.value)} className="px-3 border border-input rounded-md bg-background text-[10px] max-w-[80px]">
                    {COUNTRY_CODES.map((entry) => (
                      <option className="text-xs" key={`${entry.code}-${entry.label}`} value={entry.code}>
                        {entry.code} {entry.label}
                      </option>
                    ))}
                  </select>
                  <div className="relative flex-1">
                    <Input
                      className="text-xs"
                      placeholder={countryCode === '+91' ? '10 digit mobile number' : 'Phone number'}
                      value={formData.phone}
                      inputMode="numeric"
                      maxLength={countryCode === '+91' ? 10 : 15}
                      onChange={e => setFormData(p => ({ ...p, phone: e.target.value.replace(/\D/g, '') }))}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {countryCode === '+91' ? 'Enter exactly 10 digits.' : 'Digits only.'}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-border/50">
              <h3 className="text-xs font-semibold mb-4">Organization Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-xs">Role</Label>
                  <Select onValueChange={handleRoleChange} value={formData.role} disabled={currentUserRole !== 'admin'}>
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#197554] border border-[#1e8c65] text-white shadow-2xl text-xs">
                      {ROLES.map(r => (
                        <SelectItem key={r.id} value={r.id} className="focus:bg-[#2eb87f] opacity-90 focus:text-white text-xs cursor-pointer">
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Status</Label>
                  <Select onValueChange={val => setFormData(p => ({ ...p, status: val }))} value={formData.status} disabled={currentUserRole !== 'admin'}>
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#197554] border border-[#1e8c65] text-white shadow-2xl text-xs">
                      <SelectItem value="active" className="focus:bg-[#2eb87f] opacity-90 focus:text-white text-xs cursor-pointer">Active</SelectItem>
                      <SelectItem value="inactive" className="focus:bg-[#2eb87f] opacity-90 focus:text-white text-xs cursor-pointer">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
