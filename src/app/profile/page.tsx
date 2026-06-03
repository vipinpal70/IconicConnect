"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { OpsLayout } from "@/src/components/OpsLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Badge } from "@/src/components/ui/badge"
import { toast } from "sonner"
import { UserCircle, Mail, Phone, Briefcase, ShieldCheck, Pencil, X, Check } from "lucide-react"

type ProfileData = {
  id: string
  fullName: string | null
  email: string | null
  phone: string | null
  title: string | null
  role: string | null
  status: string | null
  userType: string | null
  createdAt: string | null
}

export default function ProfilePage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<{ fullName: string; phone: string; title: string }>({
    fullName: "", phone: "", title: "",
  })

  const { data: profile, isLoading } = useQuery<ProfileData>({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile")
      if (!res.ok) throw new Error("Failed to fetch profile")
      return res.json()
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (data: { fullName: string; phone: string; title: string }) => {
      if (!profile?.id) throw new Error("No profile")
      const res = await fetch(`/api/admin/members/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Failed to update profile")
      return payload
    },
    onSuccess: () => {
      toast.success("Profile updated")
      queryClient.invalidateQueries({ queryKey: ["my-profile"] })
      setEditing(false)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    },
  })

  const handleEdit = () => {
    setDraft({
      fullName: profile?.fullName || "",
      phone: profile?.phone || "",
      title: profile?.title || "",
    })
    setEditing(true)
  }

  const handleSave = () => {
    updateMutation.mutate(draft)
  }

  const roleLabel = profile?.role?.replace(/_/g, " ") ?? "—"
  const initials = profile?.fullName
    ? profile.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "OP"

  return (
    <OpsLayout>
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        {/* Header Card */}
        <Card className="shadow-card overflow-hidden border-border/50">
          <div className="gradient-primary h-14" />
          <CardContent className="pt-0 -mt-8 px-5 pb-4">
            <div className="flex items-end justify-between gap-3 pt-3">
              <div className="flex items-end gap-3">
                <div className="w-14 h-14 rounded-lg bg-primary border-2 border-white shadow flex items-center justify-center text-white text-lg font-bold">
                  {initials}
                </div>
                <div className="pb-0.5">
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-bold text-foreground">
                      {isLoading ? <span className="inline-block h-4 w-32 rounded bg-muted animate-pulse" /> : (profile?.fullName || "—")}
                    </h1>
                    {profile?.status && (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 border-none scale-90 origin-left capitalize">
                        {profile.status}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground capitalize">{roleLabel}</p>
                </div>
              </div>
              {!editing && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handleEdit}>
                  <Pencil className="h-3.5 w-3.5" /> Edit Profile
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Profile Details */}
        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <UserCircle className="h-3.5 w-3.5 text-primary" /> Personal Details
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {editing ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Full Name</Label>
                  <Input
                    className="h-8 text-xs"
                    value={draft.fullName}
                    onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
                    placeholder="Your full name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Phone</Label>
                  <Input
                    className="h-8 text-xs"
                    value={draft.phone}
                    onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                    placeholder="+91 XXXXX XXXXX"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Title / Designation</Label>
                  <Input
                    className="h-8 text-xs"
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="e.g. Senior Designer"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSave} disabled={updateMutation.isPending}>
                    <Check className="h-3.5 w-3.5" />
                    {updateMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setEditing(false)}>
                    <X className="h-3.5 w-3.5" /> Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <Detail icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={profile?.email || "—"} />
                <Detail icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={profile?.phone || "—"} />
                <Detail icon={<Briefcase className="h-3.5 w-3.5" />} label="Title" value={profile?.title || "—"} />
                <Detail icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Role" value={roleLabel} />
                <Detail
                  label="Member since"
                  value={profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" }) : "—"}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </OpsLayout>
  )
}

function Detail({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1 leading-none">
        {icon}{label}
      </p>
      <p className="text-[11px] font-semibold text-foreground mt-0.5 capitalize">{value}</p>
    </div>
  )
}
