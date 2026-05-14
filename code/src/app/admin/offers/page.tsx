"use client";

import { useState } from "react";
import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Badge } from "@/src/components/ui/badge";
import { Plus, Sparkles, Pencil, Trash2, Tag, Calendar, Target } from "lucide-react";
import { toast } from "sonner";

type Offer = {
  id: string;
  title: string;
  brand: string;
  category: "Intraoral Scanner" | "Materials" | "Equipment" | "Software" | "Consumables";
  description: string;
  discount: string;
  validTill: string;
  sponsored: boolean;
  targetClients: string[];
  targetLocations: string[];
};

const initialOffers: Offer[] = [
  {
    id: "OF-001",
    title: "20% Off Intraoral Scanners",
    brand: "Medit",
    category: "Intraoral Scanner",
    description: "Exclusive discount on Medit i700 for all Iconic Connect labs.",
    discount: "20% Off",
    validTill: "2024-08-30",
    sponsored: true,
    targetClients: [],
    targetLocations: ["USA"],
  },
  {
    id: "OF-002",
    title: "Zirconia Bulk Discount",
    brand: "Ivoclar",
    category: "Materials",
    description: "Buy 10 discs, get 2 free. Applicable on all e.max ZirCAD.",
    discount: "Buy 10 Get 2",
    validTill: "2024-12-31",
    sponsored: false,
    targetClients: [],
    targetLocations: [],
  }
];

export default function AdminOffers() {
  const [offers, setOffers] = useState<Offer[]>(initialOffers);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Offer>>({ category: "Materials", sponsored: false });

  const save = () => {
    if (!draft.title || !draft.brand) {
      toast.error("Title and brand are required");
      return;
    }
    const newOffer: Offer = {
      id: `OF-${String(offers.length + 1).padStart(3, "0")}`,
      title: draft.title!,
      brand: draft.brand!,
      category: (draft.category ?? "Materials") as Offer["category"],
      description: draft.description ?? "",
      discount: draft.discount ?? "",
      validTill: draft.validTill ?? "",
      sponsored: !!draft.sponsored,
      targetClients: draft.targetClients ?? [],
      targetLocations: draft.targetLocations ?? [],
    };
    setOffers([newOffer, ...offers]);
    setOpen(false);
    setDraft({ category: "Materials", sponsored: false });
    toast.success("Offer published");
  };

  const remove = (id: string) => {
    setOffers(offers.filter((o) => o.id !== id));
    toast.success("Offer removed");
  };

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Offers & Promotions</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage marketing content shown to client labs</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary border-none shadow-glow"><Plus className="h-4 w-4 mr-2" />Create New Offer</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>Create Promotional Offer</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2"><Label>Offer Title</Label><Input placeholder="e.g. Early Bird 15% Discount" value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Brand / Partner</Label><Input placeholder="e.g. 3Shape" value={draft.brand ?? ""} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} /></div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v as Offer["category"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(["Intraoral Scanner", "Materials", "Equipment", "Software", "Consumables"] as Offer["category"][]).map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2"><Label>Description</Label><Textarea placeholder="Details of the offer..." value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Discount Text</Label><Input placeholder="e.g. 15% off" value={draft.discount ?? ""} onChange={(e) => setDraft({ ...draft, discount: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Expiry Date</Label><Input type="date" value={draft.validTill ?? ""} onChange={(e) => setDraft({ ...draft, validTill: e.target.value })} /></div>
                </div>
                <Button className="w-full h-11 gradient-primary border-none shadow-glow" onClick={save}>Publish to Portal</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Offer Details", "Brand", "Category", "Discount", "Targeting", "Expiry", "Actions"].map((h) => (
                      <th key={h} className="text-left px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {offers.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground">{o.title}</span>
                          {o.sponsored && (
                            <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1 px-1.5 h-5 text-[10px]">
                              <Sparkles className="h-2.5 w-2.5" /> Sponsored
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1 max-w-[300px]">{o.description}</p>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="secondary" className="font-medium">{o.brand}</Badge>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-muted-foreground">{o.category}</td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 bg-primary/10 text-primary rounded-lg text-xs font-bold border border-primary/20">
                          {o.discount}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] flex items-center gap-1.5 text-muted-foreground">
                            <Target className="h-3 w-3" />
                            {o.targetClients?.length ? o.targetClients.join(", ") : "Global"}
                          </span>
                          {o.targetLocations?.length > 0 && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                              <Calendar className="h-3 w-3" />
                              {o.targetLocations.join(", ")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground whitespace-nowrap">{o.validTill}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toast.info("Edit modal coming soon")}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(o.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
