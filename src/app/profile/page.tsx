"use client"

import { useEffect, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { OpsLayout } from "@/src/components/OpsLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Badge } from "@/src/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/src/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { caseTypes } from "@/src/data/demoData";
import {
  getPreferences, savePreferences, type PreferenceForm,
  getUsers, saveUsers, type LabUser,
} from "@/src/lib/labStore";
import {
  Building2, Mail, Phone, MapPin, FileText, Plus, Eye, EyeOff,
  Settings2, Users, KeyRound, Trash2,
} from "lucide-react";

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
  password?: string;
  confirmPassword?: string;
  userType?: string;
  role?: string;
  status?: string;
  onBoardedAt?: string;
}

export default function ProfilePage() {
  const labId = "LAB-001";

  // Preferences
  const [prefs, setPrefs] = useState<PreferenceForm[]>(() => getPreferences(labId));
  const [prefOpen, setPrefOpen] = useState(false);
  const [draft, setDraft] = useState<{ title: string; category: string; body: string }>({
    title: "", category: "Crown & Bridge", body: "",
  });
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
    company: profile?.labName || profile?.fullName || "",
    status: profile?.status || "",
    onboardedAt: profile?.onBoardedAt ? new Date(profile.onBoardedAt).toLocaleDateString() : "",
    id: profile?.id || "",
    location: [profile?.city, profile?.state, profile?.country].filter(Boolean).join(', ') || "",
    email: profile?.email || "",
    phone: profile?.phone || "",
    poc: profile?.fullName || profile?.name || "",
    title: profile?.title || (profile?.role === 'admin' ? 'Administrator' : profile?.role) || '—',
  };

  const addPref = () => {
    if (!draft.title.trim() || !draft.body.trim()) {
      return;
    }
    const next: PreferenceForm[] = [
      { id: `PF-${Date.now()}`, title: draft.title, category: draft.category, body: draft.body, createdAt: new Date().toISOString().slice(0, 10) },
      ...prefs,
    ];
    setPrefs(next);
    savePreferences(profile?.id || labId, next);
    setDraft({ title: "", category: "Crown & Bridge", body: "" });
  };

  const removePref = (id: string) => {
    const next = prefs.filter((p) => p.id !== id);
    setPrefs(next);
    savePreferences(profile?.id || labId, next);
  };

  // Users
  const [users, setUsers] = useState<LabUser[]>(() => getUsers(labId));
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
    saveUsers(profile?.id || labId, next);
    setUserDraft({ role: "Coordinator" });
    setUserOpen(false);
  };

  const removeUser = (id: string) => {
    const next = users.filter((u) => u.id !== id);
    setUsers(next);
    saveUsers(profile?.id || labId, next);
  };

  return (
    <OpsLayout>
      <div className="space-y-4 animate-fade-in max-w-5xl mx-auto">
        {/* Header */}
        <Card className="shadow-card overflow-hidden border-border/50">
          <div className="gradient-primary h-14" />
          <CardContent className="pt-0 -mt-8 px-4 pb-3.5 flex justify-between items-center">
            <div className="flex items-end justify-between flex-wrap gap-3 pt-3">
              <div className="flex items-end gap-3">
                <div className="w-14 h-14 rounded-lg bg-card border-2 border-gray-300 shadow-card flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-bold text-foreground">{displayProfile.company}</h1>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 border-none scale-90 origin-left">{displayProfile.status}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Onboarded {displayProfile.onboardedAt} · ID {displayProfile.id}</p>
                </div>
              </div>
            </div>
            <Dialog open={prefOpen} onOpenChange={setPrefOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-8 text-xs font-semibold"><Settings2 className="h-3.5 w-3.5" /> Preferences</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Preference Forms</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                  Add one or more preference forms. These are visible to the Iconic Connect team when working on your cases.
                </p>

                <Card className="bg-muted/30 border-dashed">
                  <CardContent className="p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Title</Label>
                        <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Anterior crown preferences" />
                      </div>
                      <div className="space-y-2">
                        <Label>Applies to</Label>
                        <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="All cases">All cases</SelectItem>
                            {caseTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Details</Label>
                      <Textarea
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        placeholder="Cement gap, occlusal contact, default shade, file format..."
                        className="min-h-[100px]"
                      />
                    </div>
                    <Button onClick={addPref} className="gap-2"><Plus className="h-4 w-4" /> Save preference form</Button>
                  </CardContent>
                </Card>

                <div className="space-y-3 mt-4 max-h-[300px] overflow-y-auto pr-2">
                  {prefs.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No preference forms saved yet.</p>}
                  {prefs.map((p) => (
                    <Card key={p.id} className="shadow-sm">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <p className="font-medium text-foreground">{p.title}</p>
                            <p className="text-xs text-muted-foreground">{p.category} · added {p.createdAt}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removePref(p.id)}>
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{p.body}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="shadow-card lg:col-span-1 border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50"><CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Company Details</CardTitle></CardHeader>
            <CardContent className="p-3.5 space-y-3">
              <Detail icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={displayProfile.company} />
              <Detail icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={displayProfile.location} />
              <Detail icon={<Mail className="h-3.5 w-3.5" />} label="POC email" value={displayProfile.email} />
              <Detail icon={<Phone className="h-3.5 w-3.5" />} label="POC phone" value={displayProfile.phone} />
              <Detail label="Primary POC" value={displayProfile.poc} />
            </CardContent>
          </Card>

          <Card className="shadow-card lg:col-span-2 border-border/50">
            <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-primary" /> Allocated Price List
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3.5">
              <div className="rounded border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-3.5 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Case Type</th>
                      <th className="text-right px-3.5 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Price (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 italic">Price list is set by Iconic Connect during onboarding. Contact your account manager to revise.</p>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/50">
          <CardHeader className="py-2 px-4 flex flex-row items-center justify-between bg-muted/20 border-b border-border/50">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-primary" /> Users & Credentials
            </CardTitle>
            <Dialog open={userOpen} onOpenChange={setUserOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-8 text-xs font-semibold"><Plus className="h-3.5 w-3.5" /> Add user</Button>
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
              <table className="w-full">
                <thead className="bg-muted/30">
                  <tr className="border-b border-border">
                    {["Name", "Username", "Email", "Role", "Password", ""].map((h) => (
                      <th key={h} className="text-left px-3.5 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
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
        </Card>
      </div>
    </OpsLayout>
  );
}

function Detail({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1 leading-none">{icon}{label}</p>
      <p className="text-[11px] font-semibold text-foreground mt-0.5">{value || "—"}</p>
    </div>
  );
}
