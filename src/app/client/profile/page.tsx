"use client"

import { useEffect, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { ClientLayout } from "@/src/components/ClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Badge } from "@/src/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/src/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { getUsers, saveUsers, type LabUser } from "@/src/lib/labStore";
import { ClientPriceListModal } from "@/src/components/ClientPriceListModal";
import type { PriceListRow } from "@/src/components/PriceListTable";
import type { PriceListEntryFull } from "@/src/lib/price-list";
import {
  Building2, Mail, Phone, MapPin, Plus, Eye, EyeOff,
  Users, KeyRound, Trash2, Settings, User, FileText
} from "lucide-react";
import { useRouter } from "next/navigation";

interface Profile {
  id: string;
  fullName?: string;
  name?: string;
  title: string;
  email: string;
  phone: string;
  labName: string;
  postalCode: string;
  city: string;
  state: string;
  country: string;
  userType?: string;
  role?: string;
  status?: string;
  onBoardedAt?: string;
}

export default function ProfilePage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [priceList, setPriceList] = useState<PriceListRow[]>([]);
  const [priceListOpen, setPriceListOpen] = useState(false);
  const [users, setUsers] = useState<LabUser[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const res = await fetch("/api/profile");
        if (!res.ok) throw new Error("Failed to fetch profile");
        const data: Profile = await res.json();
        setProfile(data);

        const priceRes = await fetch("/api/client/price-list");
        if (priceRes.ok) {
          const priceJson = await priceRes.json();
          const items: PriceListEntryFull[] = Array.isArray(priceJson.data) ? priceJson.data : [];
          setPriceList(items.map((item) => ({
            id: item.id,
            catalogItemId: item.catalogItemId,
            category: item.category,
            subCategory: item.subCategory,
            unitType: item.unitType,
            defaultPrice: item.defaultPrice,
            price: item.price,
            notes: item.notes,
            sortOrder: item.sortOrder,
          })));
        }

        if (data.role !== "subuser") {
          const subusersRes = await fetch("/api/client/subusers");
          if (subusersRes.ok) {
            const subusersJson = await subusersRes.json();
            setUsers(subusersJson.data || []);
          }
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      }
    };
    load();
  }, []);

  const displayProfile = {
    company: profile?.labName || profile?.fullName || "—",
    status: profile?.status || "—",
    onboardedAt: profile?.onBoardedAt ? new Date(profile.onBoardedAt).toLocaleDateString() : "—",
    id: profile?.id || "—",
    location: [profile?.city, profile?.state, profile?.country].filter(Boolean).join(", ") || "—",
    email: profile?.email || "—",
    phone: profile?.phone || "—",
    poc: profile?.fullName || profile?.name || "—",
    title: profile?.title || (profile?.role === "admin" ? "Administrator" : profile?.role) || "—",
  };

  const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});
  const [userOpen, setUserOpen] = useState(false);
  const [userDraft, setUserDraft] = useState<Partial<LabUser>>({ role: "Coordinator" });

  const addUser = async () => {
    if (!userDraft.name || !userDraft.username || !userDraft.email) return;
    try {
      const res = await fetch("/api/client/subusers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: userDraft.name,
          username: userDraft.username,
          email: userDraft.email,
          role: userDraft.role || "Coordinator",
          password: userDraft.password,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create user");
      }
      const { data: u } = await res.json();
      setUsers((prev) => [...prev, u]);
      setUserDraft({ role: "Coordinator" });
      setUserOpen(false);
    } catch (err: any) {
      alert(err.message || "Failed to create user");
    }
  };

  const removeUser = async (id: string) => {
    if (!confirm("Are you sure you want to remove this user?")) return;
    try {
      const res = await fetch(`/api/client/subusers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete user");
      }
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err: any) {
      alert(err.message || "Failed to remove user");
    }
  };

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in max-w-5xl mx-auto">
        {/* Header banner */}
        <Card className="shadow-card overflow-hidden border-border/50">
          <div className="gradient-primary h-14" />
          <CardContent className="pt-0 -mt-8 px-4 pb-3.5 flex justify-between items-end flex-wrap gap-3">
            <div className="flex items-end gap-3 pt-6">
              <div className="w-14 h-14 rounded-lg bg-gray-200 border-2 border-gray-300 shadow-card flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-semibold text-foreground">{displayProfile.company}</h1>
                  <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 border border-green-200 scale-90 origin-left capitalize">
                    {displayProfile.status}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">Onboarded {displayProfile.onboardedAt}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs font-semibold gap-1.5"
                onClick={() => setPriceListOpen(true)}
              >
                <FileText className="h-3.5 w-3.5" />
                Allocated Price List
              </Button>

              {profile?.role !== "subuser" && (
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-[#238c67] h-8 text-xs font-semibold"
                  onClick={() => router.push("/client/preferences")}
                >
                  <Settings className="h-3.5 w-3.5 mr-1" />
                  Preferences
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Company Details */}
        <Card className="shadow-card border-border/50 max-w-sm">
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Company Details</CardTitle>
          </CardHeader>
          <CardContent className="p-3.5 space-y-3">
            <Detail icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={displayProfile.company} />
            <Detail icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={displayProfile.location} />
            <Detail icon={<Mail className="h-3.5 w-3.5" />} label="POC Email" value={displayProfile.email} />
            <Detail icon={<Phone className="h-3.5 w-3.5" />} label="POC Phone" value={displayProfile.phone} />
            <Detail icon={<User className="h-3.5 w-3.5" />} label="Primary POC" value={displayProfile.poc} />
          </CardContent>
        </Card>

        {/* Users & Credentials — only visible to the parent client */}
        {profile?.role !== "subuser" && <Card className="shadow-card border-border/50">
            <CardHeader className="py-2 px-4 flex flex-row items-center justify-between bg-muted/20 border-b border-border/50">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-primary" /> Users & Credentials
              </CardTitle>
              <Dialog open={userOpen} onOpenChange={setUserOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5 h-8 text-xs font-semibold">
                    <Plus className="h-3.5 w-3.5" /> Add user
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle>Add New Lab User</DialogTitle></DialogHeader>
                  <div className="space-y-4 mt-2">
                    <div className="space-y-2"><Label>Full Name</Label><Input value={userDraft.name ?? ""} onChange={(e) => setUserDraft({ ...userDraft, name: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Username</Label><Input value={userDraft.username ?? ""} onChange={(e) => setUserDraft({ ...userDraft, username: e.target.value })} /></div>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <Select value={userDraft.role ?? "Coordinator"} onValueChange={(v) => setUserDraft({ ...userDraft, role: v as LabUser["role"] })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(["Owner", "Manager", "Coordinator", "Technician"] as const).map((r) => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2"><Label>Email</Label><Input type="email" value={userDraft.email ?? ""} onChange={(e) => setUserDraft({ ...userDraft, email: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Password</Label><Input type="password" minLength={6} placeholder="Minimum 6 characters" value={userDraft.password ?? ""} onChange={(e) => setUserDraft({ ...userDraft, password: e.target.value })} /></div>
                  </div>
                  <DialogFooter className="mt-6">
                    <Button onClick={addUser} className="w-full sm:w-auto">Create user</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/30">
                    <tr className="border-b border-border">
                      {["Name", "Username", "Email", "Role", "Password", ""].map((h) => (
                        <th key={h} className="text-left px-3.5 py-2 text-xs font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-3.5 py-1.5 text-[11px] font-bold text-foreground">{u.name}</td>
                        <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground">{u.username}</td>
                        <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground">{u.email}</td>
                        <td className="px-3.5 py-1.5">
                          <Badge variant="outline" className="font-normal border-border text-muted-foreground scale-90 origin-left text-[10px] px-1.5 py-0.5">{u.role}</Badge>
                        </td>
                        <td className="px-3.5 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <KeyRound className="h-3 w-3 text-muted-foreground shrink-0" />
                            <code className="text-[10px] bg-muted/40 px-1.5 py-0.5 rounded text-foreground font-mono leading-none">
                              {showPwd[u.id] ? u.password : "••••••••"}
                            </code>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowPwd((s) => ({ ...s, [u.id]: !s[u.id] }))}>
                              {showPwd[u.id] ? <EyeOff className="h-3 w-3 text-muted-foreground" /> : <Eye className="h-3 w-3 text-muted-foreground" />}
                            </Button>
                          </div>
                        </td>
                        <td className="px-3.5 py-1.5 text-right">
                          {u.role !== "Owner" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeUser(u.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>}

        {/* Allocated Price List Modal */}
        <ClientPriceListModal
          open={priceListOpen}
          onClose={() => setPriceListOpen(false)}
          clientName={displayProfile.company}
          items={priceList}
        />
      </div>
    </ClientLayout>
  );
}

function Detail({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground tracking-wide flex items-center gap-1 leading-none">{icon}{label}</p>
      <p className="text-[12px] font-normal text-foreground mt-1">{value || "—"}</p>
    </div>
  );
}
