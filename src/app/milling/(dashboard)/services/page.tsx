"use client"

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Wrench } from "lucide-react";
import type { ServiceType } from "@/src/lib/case-status-mapping";

interface CatalogRow {
  id: string;
  serviceType: ServiceType;
  category: string;
  subCategory: string;
  unitType: string;
  partnerRate: string;
  monthlyCapacity: number | null;
  turnaroundDays: number | null;
  isActive: boolean;
}

interface ServicesResponse {
  enabledServiceTypes: ServiceType[];
  catalog: CatalogRow[];
}

const FLOW_LABELS: Record<ServiceType, string> = {
  design_only: "Design",
  design_milling: "Design + Milling",
  milling_only: "Milling Only",
};

const UNIT_LABELS: Record<string, string> = {
  per_tooth: "per tooth",
  per_arch: "per arch",
  per_case: "per case",
};

const FLOW_ORDER: ServiceType[] = ["design_only", "design_milling", "milling_only"];

async function fetchServices(): Promise<ServicesResponse> {
  const res = await fetch("/api/milling/services");
  if (!res.ok) throw new Error("Failed to load services");
  const json = await res.json();
  return json.data;
}

export default function MillingServicesPage() {
  const { data, isLoading } = useQuery<ServicesResponse>({
    queryKey: ["milling-services"],
    queryFn: fetchServices,
  });

  const enabledFlows = useMemo(
    () => FLOW_ORDER.filter((flow) => (data?.enabledServiceTypes ?? []).includes(flow)),
    [data],
  );
  const [activeFlow, setActiveFlow] = useState<ServiceType | null>(null);
  const currentFlow = activeFlow && enabledFlows.includes(activeFlow) ? activeFlow : enabledFlows[0];

  const rowsForFlow = (flow: ServiceType) =>
    (data?.catalog ?? [])
      .filter((row) => row.serviceType === flow)
      .sort((a, b) => a.category.localeCompare(b.category) || a.subCategory.localeCompare(b.subCategory));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">My Services</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What Iconic has enabled and priced for your centre · view only — contact Iconic Support to request a change
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : enabledFlows.length === 0 ? (
        <Card className="shadow-card">
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            No service flow has been enabled for your centre yet. Contact Iconic Support if you expect to see one here.
          </CardContent>
        </Card>
      ) : (
        <>
          <Tabs value={currentFlow} onValueChange={(v) => setActiveFlow(v as ServiceType)}>
            <TabsList>
              {enabledFlows.map((flow) => (
                <TabsTrigger key={flow} value={flow}>{FLOW_LABELS[flow]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {enabledFlows.map((flow) => {
            if (flow !== currentFlow) return null;
            const rows = rowsForFlow(flow);
            return (
              <Card key={flow} className="shadow-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wrench className="h-4 w-4" /> {FLOW_LABELS[flow]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          {["Service", "Unit", "Your Rate", "Turnaround", "Monthly Capacity", "Status"].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No services on this flow yet.</td></tr>
                        ) : rows.map((row) => (
                          <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                            <td className="px-4 py-3">
                              <p className="text-foreground font-medium">{row.category}</p>
                              <p className="text-xs text-muted-foreground">{row.subCategory}</p>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{UNIT_LABELS[row.unitType] ?? row.unitType}</td>
                            <td className="px-4 py-3 text-foreground font-medium">${Number(row.partnerRate).toFixed(2)}</td>
                            <td className="px-4 py-3 text-muted-foreground">{row.turnaroundDays ? `${row.turnaroundDays}d` : "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{row.monthlyCapacity ?? "No cap"}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${row.isActive ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-gray-100 text-gray-600 border border-gray-200"}`}>
                                {row.isActive ? "Active" : "Inactive"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
