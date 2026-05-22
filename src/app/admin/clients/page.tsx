"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Card, CardContent } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { Badge } from "@/src/components/ui/badge"
import { Building2, Mail, Phone, MapPin, Plus, ShieldCheck, ArrowRight } from "lucide-react"
import { toast } from "sonner"

type ClientProfile = {
  id: string
  fullName: string | null
  email: string
  labName: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: string
  plan: string
  createdAt: string
}

const statusColor: Record<string, string> = {
  Active: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  Onboarding: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  Trial: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Onboarded: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  pending: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Paused: "bg-slate-500/10 text-slate-500 border-slate-500/20",
}

export default function AdminClients() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [onboardOpen, setOnboardOpen] = useState(false)

  const { data: clients, isLoading, error } = useQuery<ClientProfile[]>({
    queryKey: ["pendingClients"],
    queryFn: async () => {
      const res = await fetch("/api/admin/clients")
      if (!res.ok) throw new Error("Failed to fetch clients")
      return res.json()
    },
  })

  const approveMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const res = await fetch("/api/admin/clients/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      })
      if (!res.ok) throw new Error("Failed to approve client")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pendingClients"] })
      toast.success("Client approved successfully")
    },
  })

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={(error as Error).message} />

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Clients</h1>
            <p className="mt-1 text-sm text-muted-foreground">Review registrations, manage profiles and price lists</p>
          </div>

          <Button onClick={() => setOnboardOpen(true)} className="gradient-primary border-none shadow-glow">
            <Plus className="mr-2 h-4 w-4" />
            Onboard Client
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {clients?.map((client) => (
            <Card
              key={client.id}
              className="group cursor-pointer border-border/50 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-glow"
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/admin/clients/${client.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  router.push(`/admin/clients/${client.id}`)
                }
              }}
            >
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">
                      {client.labName?.charAt(0) || client.fullName?.charAt(0) || <Building2 className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground group-hover:text-primary">{client.labName || "No Lab Name"}</p>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{client.id.slice(0, 8)}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={statusColor[client.status === "pending" ? "pending" : client.plan] || statusColor.Active}>
                    {client.status === "pending" ? "Pending Approval" : client.plan}
                  </Badge>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 text-primary/60" />
                    <span className="truncate">{client.city || "No City"}, {client.state || "No State"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 text-primary/60" />
                    <span className="truncate">{client.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 text-primary/60" />
                    <span>{client.phone || "No Phone"}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border/50 pt-3 text-xs">
                  <span className="text-muted-foreground">
                    POC: <span className="font-medium text-foreground">{client.fullName || "-"}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Reg: <span className="font-medium text-foreground">{format(new Date(client.createdAt), "MMM dd")}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 text-xs text-primary">
                  <span className="font-medium">Open client profile</span>
                  <ArrowRight className="h-4 w-4" />
                </div>

                {client.status === "pending" && (
                  <Button
                    className="mt-2 h-8 w-full gap-2 text-xs"
                    onClick={(event) => {
                      event.stopPropagation()
                      approveMutation.mutate(client.id)
                    }}
                    disabled={approveMutation.isPending}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Approve Registration
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Dialog open={onboardOpen} onOpenChange={setOnboardOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Onboard New Client</DialogTitle>
            </DialogHeader>
            <div className="mt-2 space-y-4">
              <div className="space-y-2">
                <Label>Company / Lab Name</Label>
                <Input placeholder="PrecisionDent Lab" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>POC Name</Label>
                  <Input placeholder="Daniel Ortega" />
                </div>
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input placeholder="Miami" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" placeholder="daniel@lab.com" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input placeholder="+1..." />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea placeholder="Special preferences..." />
              </div>
              <Button
                className="w-full border-none shadow-glow gradient-primary"
                onClick={() => {
                  toast.info("Manual onboarding is restricted. Please use the Admin Sign-up link.")
                  setOnboardOpen(false)
                }}
              >
                Send Invitation
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  )
}

function LoadingSpinner() {
  return (
    <AdminLayout>
      <div className="flex h-[60vh] items-center justify-center">
        <div className="relative flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 border-primary" />
          <div className="absolute h-8 w-8 animate-pulse rounded-full bg-primary/10" />
        </div>
      </div>
    </AdminLayout>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <AdminLayout>
      <div className="flex h-[60vh] items-center justify-center p-4">
        <div className="max-w-md rounded-2xl border border-red-100 bg-red-50 p-6 text-center shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-red-900">Error Loading Clients</h3>
          <p className="text-sm text-red-700">{message}</p>
        </div>
      </div>
    </AdminLayout>
  )
}
