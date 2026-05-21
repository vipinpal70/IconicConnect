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
import {
  Building2, Mail, Phone, MapPin, FileText, Plus, Eye, EyeOff,
  Users, KeyRound, Trash2, Settings
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

// Mock lab data for UI
const mockLab = {
  id: "LAB-001",
  company: "PrecisionDent Lab",
  status: "Active",
  onboardedAt: "2024-01-15",
  location: "Miami, FL, USA",
  email: "admin@precisiondent.com",
  phone: "+1 (555) 123-4567",
  poc: "Daniel Ortega",
  monthlyVolume: 120,
  preferences: "Prefer digital impressions via iTero.",
  priceList: [
    { caseType: "Crown & Bridge", price: 35 },
    { caseType: "Implants", price: 65 },
    { caseType: "Removables", price: 45 },
    { caseType: "Orthodontics", price: 120 },
  ]
};

export default function ProfilePage() {
  const lab = mockLab;
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);

  // fetch profile data from the api route and set it to the profile state
  useEffect(() => {
    const getProfile = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const res = await fetch("/api/profile");
        if (!res.ok) {
          throw new Error("Failed to fetch profile");
        }
        const data: Profile = await res.json();
        setProfile(data);
      } catch (err) {
        console.error("Error fetching profile:", err);
      }
    };
    getProfile();
  }, []);

  const displayProfile = {
    company: profile?.labName || profile?.fullName || lab.company,
    status: profile?.status || lab.status,
    onboardedAt: profile?.onBoardedAt ? new Date(profile.onBoardedAt).toLocaleDateString() : lab.onboardedAt,
    id: profile?.id || lab.id,
    location: [profile?.city, profile?.state, profile?.country].filter(Boolean).join(', ') || lab.location,
    email: profile?.email || lab.email,
    phone: profile?.phone || lab.phone,
    poc: profile?.fullName || profile?.name || lab.poc,
    title: profile?.title || (profile?.role === 'admin' ? 'Administrator' : profile?.role) || '—',
  };

  // Users
  const [users, setUsers] = useState<LabUser[]>(() => getUsers(lab.id));
  const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});
  const [userOpen, setUserOpen] = useState(false);
  const [userDraft, setUserDraft] = useState<Partial<LabUser>>({ role: "Coordinator" });

  const addUser = () => {
    if (!userDraft.name || !userDraft.username || !userDraft.email) {
      return;
    }
    const u: LabUser = {
      id: `U${Date.now()}`,
      name: userDraft.name!,
      username: userDraft.username!,
      email: userDraft.email!,
      role: (userDraft.role as LabUser["role"]) ?? "Coordinator",
      password: userDraft.password || `Welcome@${Math.floor(1000 + Math.random() * 9000)}`,
    };
    const next = [...users, u];
    setUsers(next);
    if (profile?.id) {
      saveUsers(profile.id, next);
    }
    setUserDraft({ role: "Coordinator" });
    setUserOpen(false);
  };

  const removeUser = (id: string) => {
    const next = users.filter((u) => u.id !== id);
    setUsers(next);
    if (profile?.id) {
      saveUsers(profile.id, next);
    }
  };

  return (
    <ClientLayout>
      <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
        {/* Header */}
        <Card className="shadow-card overflow-hidden">
          <div className="gradient-primary h-20" />
          <CardContent className="pt-0 -mt-10 px-6 pb-6 flex justify-between items-center">
            <div className="flex items-end justify-between flex-wrap gap-4 pt-4">
              <div className="flex items-end gap-4">
                <div className="w-20 h-20 rounded-xl bg-gray-200 border-2 border-gray-300 shadow-card flex items-center justify-center">
                  <Building2 className="h-9 w-9 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-semibold text-foreground">{displayProfile.company}</h1>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 border border-green-200">{displayProfile.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Onboarded {displayProfile.onboardedAt} · ID {displayProfile.id}</p>
                </div>
              </div>
            </div>

            <Button
              className="bg-primary text-primary-foreground hover:bg-[#238c67] mb-2"
              onClick={() => router.push("/client/preferences")}
            >
              <Settings className="h-4 w-4 mr-1" />
              Preferences
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="shadow-card lg:col-span-1">
            <CardHeader className="pb-4"><CardTitle className="text-base font-medium">Company Details</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Detail icon={<Building2 className="h-4 w-4" />} label="Company" value={displayProfile.company} />
              <Detail icon={<MapPin className="h-4 w-4" />} label="Location" value={displayProfile.location} />
              <Detail icon={<Mail className="h-4 w-4" />} label="POC email" value={displayProfile.email} />
              <Detail icon={<Phone className="h-4 w-4" />} label="POC phone" value={displayProfile.phone} />
              <Detail label="Primary POC" value={displayProfile.poc} />
              {profile?.userType !== 'admin_portal' && (
                <Detail label="Monthly volume" value={`~${lab.monthlyVolume} cases / month`} />
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card lg:col-span-2">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Allocated Price List
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Case Type</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Price (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lab.priceList.map((p) => (
                      <tr key={p.caseType}>
                        <td className="px-4 py-3 text-foreground">{p.caseType}</td>
                        <td className="px-4 py-3 text-right font-medium text-foreground">${p.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3 italic">Price list is set by Iconic Connect during onboarding. Contact your account manager to revise.</p>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card">
          <CardHeader className="pb-4 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Users & Credentials
            </CardTitle>
            <Dialog open={userOpen} onOpenChange={setUserOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Add user</Button>
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
                          {(["Owner", "Manager", "Coordinator", "Technician"] as const).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2"><Label>Email</Label><Input type="email" value={userDraft.email ?? ""} onChange={(e) => setUserDraft({ ...userDraft, email: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Temporary Password <span className="text-muted-foreground font-normal">(optional)</span></Label><Input value={userDraft.password ?? ""} onChange={(e) => setUserDraft({ ...userDraft, password: e.target.value })} /></div>
                </div>
                <DialogFooter className="mt-6"><Button onClick={addUser} className="w-full sm:w-auto">Create user</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="border-b border-border">
                    {["Name", "Username", "Email", "Role", "Password", ""].map((h) => (
                      <th key={h} className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-6 py-4 font-medium text-foreground">{u.name}</td>
                      <td className="px-6 py-4 text-muted-foreground">{u.username}</td>
                      <td className="px-6 py-4 text-muted-foreground">{u.email}</td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className="font-normal border-border text-muted-foreground">{u.role}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                          <code className="text-xs bg-muted/40 px-2 py-1 rounded text-foreground font-mono">
                            {showPwd[u.id] ? u.password : "••••••••"}
                          </code>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowPwd((s) => ({ ...s, [u.id]: !s[u.id] }))}>
                            {showPwd[u.id] ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                          </Button>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {u.role !== "Owner" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeUser(u.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ClientLayout>
  );
}

function Detail({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</p>
      <p className="text-foreground font-medium mt-1">{value || "—"}</p>
    </div>
  );
}
