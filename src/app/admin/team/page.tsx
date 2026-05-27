"use client"

import * as React from "react"
import { useState, useMemo, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Card, CardContent, CardHeader } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import { Input } from "@/src/components/ui/input"
import {
  Users, UserPlus, Search, Mail, Shield,
  MoreHorizontal, KeyRound, Edit2, Trash2, Calendar
} from "lucide-react"
import { AddMemberModal } from "./_components/AddMemberModal"
import { CredentialsModal } from "./_components/CredentialsModal"
import { toast } from "sonner"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator
} from "@/src/components/ui/dropdown-menu"
import { Switch } from "@/src/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import Link from "next/link"
import { useRouter } from "next/navigation"

interface Profile {
  id: string
  fullName: string | null
  email: string
  role: string
  status: string
  createdAt: string
  userType: string
}

const FILTER_ROLES = [
  { id: 'all', name: 'All Roles' },
  { id: 'admin', name: 'Admin' },
  { id: 'qc', name: 'QC' },
  { id: 'account_manager', name: 'Account Manager' },
  { id: 'designer', name: 'Designer' },
  { id: 'consultant', name: 'Consultant' },
]

export default function TeamPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [roleFilter, setRoleFilter] = useState<string>("all")
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [credMember, setCredMember] = useState<Profile | null>(null)
  const [credModalOpen, setCredModalOpen] = useState(false)

  const { data: currentUser, isLoading: isUserLoading, error: userError } = useQuery<Profile>({
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

  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') {
      router.push(`/admin/team/${currentUser.id}`)
    }
  }, [currentUser, router])

  const { data: members = [], isLoading } = useQuery<Profile[]>({
    queryKey: ['members'],
    queryFn: async () => {
      const res = await fetch('/api/admin/members')
      if (!res.ok) throw new Error('Failed to fetch members')
      return res.json()
    },
    enabled: currentUser?.role === 'admin'
  })

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string, status: string }) => {
      const res = await fetch(`/api/admin/members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed to update status')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Member status updated')
      queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/members/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete member')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Member deleted')
      queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      const matchesSearch = (m.fullName?.toLowerCase() || "").includes(search.toLowerCase()) ||
        m.email.toLowerCase().includes(search.toLowerCase())
      const matchesStatus = statusFilter === "all" || m.status === statusFilter
      const matchesRole = roleFilter === "all" || m.role === roleFilter
      return matchesSearch && matchesStatus && matchesRole
    })
  }, [members, search, statusFilter, roleFilter])

  const stats = useMemo(() => {
    return {
      total: members.length,
      active: members.filter(m => m.status === 'active').length,
      inactive: members.filter(m => m.status === 'inactive').length,
    }
  }, [members])

  if (isUserLoading) return <AdminLayout><div className="p-8 text-center">Loading session...</div></AdminLayout>
  if (userError) return <AdminLayout><div className="p-8 text-center text-red-500">Error: {(userError as Error).message}</div></AdminLayout>
  
  // If not admin, the useEffect will handle the redirect. 
  // We return null here to avoid rendering the table for non-admins.
  if (currentUser && currentUser.role !== 'admin') return null
  if (!currentUser) return <AdminLayout><div className="p-8 text-center">Loading session...</div></AdminLayout>

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <Users className="w-6 h-6 text-primary" />
              Team Management
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage organization members, roles, and access controls.
            </p>
          </div>
          <Button onClick={() => setAddModalOpen(true)} className="gap-2 shadow-glow">
            <UserPlus className="w-4 h-4" />
            Add Member
          </Button>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                {stats.total}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total Members</p>
                <p className="text-lg font-bold">{stats.total}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-600 font-bold">
                {stats.active}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active</p>
                <p className="text-lg font-bold">{stats.active}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 font-bold">
                {stats.inactive}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Inactive</p>
                <p className="text-lg font-bold">{stats.inactive}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters & Table */}
        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardHeader className="border-b border-border/50 pb-4">
            <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  className="pl-9 bg-muted/30 border-none h-10"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-1.5 bg-muted/20 p-1 rounded-lg border border-border/50">
                  <div className="flex items-center gap-1">
                    <Button
                      variant={statusFilter === "all" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 text-xs font-medium"
                      onClick={() => setStatusFilter("all")}
                    >
                      All Status
                    </Button>
                    <Button
                      variant={statusFilter === "active" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 text-xs font-medium"
                      onClick={() => setStatusFilter("active")}
                    >
                      Active
                    </Button>
                    <Button
                      variant={statusFilter === "inactive" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 text-xs font-medium"
                      onClick={() => setStatusFilter("inactive")}
                    >
                      Inactive
                    </Button>
                  </div>

                  <div className="h-6 w-[1px] bg-border/50 mx-1 hidden sm:block" />

                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[140px] sm:w-[160px] bg-transparent hover:bg-muted/10 border-none h-8 text-xs font-medium focus:ring-0 focus:ring-offset-0">
                      <SelectValue placeholder="All Roles" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#197554] border border-[#1e8c65] text-white shadow-2xl">
                      {FILTER_ROLES.map(r => (
                        <SelectItem key={r.id} value={r.id} className="focus:bg-[#2eb87f] opacity-90 focus:text-white text-xs cursor-pointer">
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border/50">
                  <tr>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Member</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Joined</th>
                    <th className="text-right px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {isLoading ? (
                    [1, 2, 3].map(i => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-6 py-4"><div className="h-10 w-40 bg-muted rounded" /></td>
                        <td className="px-6 py-4"><div className="h-6 w-20 bg-muted rounded" /></td>
                        <td className="px-6 py-4"><div className="h-6 w-16 bg-muted rounded" /></td>
                        <td className="px-6 py-4"><div className="h-6 w-24 bg-muted rounded" /></td>
                        <td className="px-6 py-4"><div className="h-8 w-8 ml-auto bg-muted rounded" /></td>
                      </tr>
                    ))
                  ) : filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                        No members found matching your criteria.
                      </td>
                    </tr>
                  ) : filteredMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-muted/20 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${member.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            {member.fullName?.slice(0, 2).toUpperCase() || '??'}
                          </div>
                          <div>
                            <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                              {member.fullName || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className="bg-muted/50 border-border/50 font-medium capitalize">
                          <Shield className="w-3 h-3 mr-1" />
                          {member.role.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={member.status === 'active'}
                            onCheckedChange={(val) => statusMutation.mutate({ id: member.id, status: val ? 'active' : 'inactive' })}
                            disabled={statusMutation.isPending}
                          />
                          <span className={`text-xs font-medium ${member.status === 'active' ? 'text-green-600' : 'text-muted-foreground'}`}>
                            {member.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(member.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem asChild>
                              <Link href={`/admin/team/${member.id}`} className="flex items-center gap-2">
                                <Edit2 className="w-4 h-4" />
                                Edit Profile
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="flex items-center gap-2"
                              onClick={() => {
                                setCredMember(member)
                                setCredModalOpen(true)
                              }}
                            >
                              <KeyRound className="w-4 h-4" />
                              Credentials
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={member.id === currentUser.id}
                              className="flex items-center gap-2 text-red-500 hover:text-red-600 focus:text-red-600 focus:bg-red-50 disabled:text-muted-foreground disabled:hover:text-muted-foreground disabled:focus:text-muted-foreground disabled:focus:bg-transparent"
                              onClick={() => {
                                if (member.id !== currentUser.id && confirm(`Permanently delete ${member.fullName || member.email}?`)) {
                                  deleteMutation.mutate(member.id)
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                              {member.id === currentUser.id ? 'Delete Disabled For You' : 'Delete Member'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <AddMemberModal open={addModalOpen} onOpenChange={setAddModalOpen} />
        <CredentialsModal
          open={credModalOpen}
          onOpenChange={setCredModalOpen}
          member={credMember}
        />
      </div>
    </AdminLayout>
  )
}
