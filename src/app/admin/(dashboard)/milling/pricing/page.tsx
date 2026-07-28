"use client"

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { MillingSubNav } from "../_components/MillingSubNav";
import { Lock, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import type { PriceListEntryFull } from "@/src/lib/price-list";

interface PartnerRateRow {
  id: string;
  millingCenterId: string;
  millingCenterName: string;
  category: string;
  subCategory: string;
  partnerRate: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Failed to load ${url}`);
  }
  const json = await res.json();
  return json.data;
}

export default function MillingPricingPage() {
  const queryClient = useQueryClient();
  // Only edited prices live in state — everything else is derived straight
  // from the query data, so there's no query-result-into-state sync to manage.
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const { data: designMilling = [], isLoading: designMillingLoading } = useQuery<PriceListEntryFull[]>({
    queryKey: ["admin-service-catalog", "design_milling"],
    queryFn: () => fetchJson("/api/admin/service-catalog?serviceType=design_milling"),
  });

  const { data: designOnly = [] } = useQuery<PriceListEntryFull[]>({
    queryKey: ["admin-service-catalog", "design_only"],
    queryFn: () => fetchJson("/api/admin/service-catalog?serviceType=design_only"),
  });

  const { data: partnerRates = [], isLoading: partnerRatesLoading } = useQuery<PartnerRateRow[]>({
    queryKey: ["admin-milling-service-catalog"],
    queryFn: () => fetchJson("/api/admin/milling/service-catalog"),
  });

  const rows = designMilling.map((r) => (r.catalogItemId in overrides ? { ...r, price: overrides[r.catalogItemId] } : r));

  const saveMutation = useMutation({
    mutationFn: async (items: PriceListEntryFull[]) => {
      const res = await fetch("/api/admin/service-catalog", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map((r) => ({ id: r.catalogItemId, defaultPrice: r.price })) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Design + Milling price list saved");
      setOverrides({});
      queryClient.invalidateQueries({ queryKey: ["admin-service-catalog", "design_milling"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const designPriceOf = (category: string, subCategory: string) =>
    designOnly.find((r) => r.category === category && r.subCategory === subCategory)?.defaultPrice;

  const lowestPartnerRate = (category: string, subCategory: string) => {
    const rates = partnerRates.filter((r) => r.category === category && r.subCategory === subCategory);
    return rates.length ? Math.min(...rates.map((r) => Number(r.partnerRate))) : undefined;
  };

  const updatePrice = (catalogItemId: string, price: number) =>
    setOverrides((prev) => ({ ...prev, [catalogItemId]: price }));

  const totalMargin = rows.reduce((sum, r) => {
    const cost = lowestPartnerRate(r.category, r.subCategory) ?? 0;
    return sum + (r.price - cost);
  }, 0);

  const isLoading = designMillingLoading || partnerRatesLoading;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Pricing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Two flat price lists — Design and Design + Milling — set directly by admin. Milling centre partner rates are cost reference only, never auto-applied.
          </p>
        </div>
      </div>

      <MillingSubNav />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="shadow-card lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">Design + Milling price list</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Category / Restoration", "Design price", "Design + Milling price", "Partner rate (ref.)", "Margin"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const designPrice = designPriceOf(r.category, r.subCategory);
                    const cost = lowestPartnerRate(r.category, r.subCategory);
                    const margin = cost !== undefined ? r.price - cost : undefined;
                    return (
                      <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{r.subCategory}</p>
                          <p className="text-xs text-muted-foreground">{r.category} · {r.unitType.replace("_", " ")}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{designPrice !== undefined ? `$${designPrice.toFixed(2)}` : "—"}</td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            className="h-8 w-24 text-xs"
                            value={r.price}
                            onChange={(e) => updatePrice(r.catalogItemId, +e.target.value)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {cost !== undefined ? (
                            <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
                              <Lock className="h-3 w-3" /> ${cost.toFixed(2)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {margin !== undefined ? <span className="text-success">+${margin.toFixed(2)}</span> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No Design + Milling catalog items yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="shadow-card">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs"><TrendingUp className="h-3.5 w-3.5" />Total gross margin (reference)</div>
                <p className="text-2xl font-semibold text-foreground mt-2">${totalMargin.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-1">Design+Milling price vs. lowest partner rate per service — for reference only</p>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-base">Milling centre partner rates</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {partnerRates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No partner rates set by any centre yet.</p>
                ) : (
                  partnerRates.map((r) => (
                    <div key={r.id} className="flex items-center justify-between border-b border-border last:border-0 pb-2 last:pb-0">
                      <div>
                        <p className="text-foreground">{r.subCategory}</p>
                        <p className="text-xs text-muted-foreground">{r.millingCenterName}</p>
                      </div>
                      <span className="font-mono text-muted-foreground">${Number(r.partnerRate).toFixed(2)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(rows)}
            >
              {saveMutation.isPending ? "Saving…" : "Save price list changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
