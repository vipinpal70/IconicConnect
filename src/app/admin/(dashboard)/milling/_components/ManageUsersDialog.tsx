"use client"

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Badge } from "@/src/components/ui/badge";
import { UserPlus, RefreshCw, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { MillingCenter } from "@/src/db/schema/milling";

interface MillingUser {
  id: string;
  fullName: string | null;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

const ROLES = [
  { id: "milling_admin", name: "Milling Admin" },
  { id: "milling_production", name: "Milling Production" },
  { id: "milling_support", name: "Milling Support" },
];

const emptyForm = { fullName: "", email: "", password: "", role: "milling_admin", phone: "" };

export function ManageUsersDialog({
  center,
  open,
  onOpenChange,
}: {
  center: MillingCenter | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [generatedPass, setGeneratedPass] = useState<string | null>(null);

  const usersQuery = useQuery<MillingUser[]>({
    queryKey: ["milling-center-users", center?.id],
    enabled: open && Boolean(center),
    queryFn: async () => {
      const res = await fetch(`/api/admin/milling/users?millingCenterId=${center!.id}`);
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/admin/milling/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, millingCenterId: center!.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add user");
      }
      return res.json();
    },
    onSuccess: () => {
      setGeneratedPass(form.password);
      queryClient.invalidateQueries({ queryKey: ["milling-center-users", center?.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const generatePassword = () => {
    const pass = Math.random().toString(36).slice(-10) + "!";
    setForm((prev) => ({ ...prev, password: pass }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setGeneratedPass(null);
  };

  const handleClose = (v: boolean) => {
    if (!v) resetForm();
    onOpenChange(v);
  };

  if (!center) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Users · {center.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="border border-border rounded-lg divide-y divide-border">
            {usersQuery.isLoading ? (
              <p className="text-xs text-muted-foreground p-3">Loading…</p>
            ) : !usersQuery.data?.length ? (
              <p className="text-xs text-muted-foreground p-3">No users yet for this centre.</p>
            ) : (
              usersQuery.data.map((u) => (
                <div key={u.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{u.fullName || u.email}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] capitalize">{u.role.replace(/_/g, " ")}</Badge>
                    <Badge variant={u.status === "active" ? "secondary" : "outline"} className="text-[10px] capitalize">{u.status}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>

          {generatedPass ? (
            <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 text-center space-y-3">
              <CheckCircle2 className="w-6 h-6 text-green-500 mx-auto" />
              <p className="text-sm text-foreground">Credentials sent to <span className="font-medium">{form.email}</span></p>
              <div className="bg-white border border-border rounded-lg p-2.5 flex items-center justify-between">
                <code className="text-sm font-mono font-bold text-primary">{generatedPass}</code>
                <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(generatedPass); toast.success("Password copied"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button className="w-full" size="sm" onClick={resetForm}>Add another user</Button>
            </div>
          ) : (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" />Add user</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Full name</Label>
                  <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password</Label>
                  <div className="flex gap-1.5">
                    <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                    <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={generatePassword}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                className="w-full"
                disabled={mutation.isPending || !form.fullName || !form.email || !form.password}
                onClick={() => mutation.mutate(form)}
              >
                {mutation.isPending ? "Adding…" : "Add user"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
