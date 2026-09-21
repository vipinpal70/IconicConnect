"use client"

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { MillingStatusBadge, type MillingStatus } from "@/src/components/MillingStatusBadge";
import { INTERNAL_STATUS_LABELS } from "@/src/db/schema/case";
import { millingStatusEnum } from "@/src/db/schema/milling";
import { Search, Download } from "lucide-react";
import { useRouter } from "next/navigation";

interface MillingCaseRow {
  caseId: string;
  caseNumber: string | null;
  category: string | null;
  subCategory: string | null;
  toothNumbers: number[];
  modelRequired: boolean;
  dueDate: string | null;
  status: string;
  queue: "design" | "production";
  millingStatus: MillingStatus | null;
}

const STATUS_FILTERS: ("all" | MillingStatus)[] = ["all", ...millingStatusEnum.enumValues];

// Design-leg status a case can actionably be in from this centre's side —
// case-flow-update-plan.md §7.2/§7.3. Anything else (submitted_to_client,
// approved, on_hold, etc.) is read-only for the centre.
function designStatusLabel(status: string): string {
  if (status === "allocated_to_designer") return "New Assignment";
  if (status === "in_progress") return "In Progress";
  if (status === "internal_qc") return "Awaiting QC";
  if (status === "client_feedback") return "Revision Requested";
  return INTERNAL_STATUS_LABELS[status as keyof typeof INTERNAL_STATUS_LABELS] ?? status;
}

export default function MillingCasesPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<"production" | "design">("production");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | MillingStatus>("all");

  const { data: cases = [], isLoading } = useQuery<MillingCaseRow[]>({
    queryKey: ["milling-cases", queue, queue === "production" ? status : null],
    queryFn: async () => {
      const params = new URLSearchParams({ queue });
      if (queue === "production" && status !== "all") params.set("status", status);
      const res = await fetch(`/api/milling/cases?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load cases");
      const json = await res.json();
      return json.data;
    },
  });

  const list = cases.filter((c) => {
    const s = q.toLowerCase();
    return !s || (c.caseNumber ?? "").toLowerCase().includes(s) || (c.subCategory ?? "").toLowerCase().includes(s);
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Assigned Cases</h1>
        <p className="text-sm text-muted-foreground mt-1">Only cases assigned to your centre are shown · Client identity is hidden except shipping details</p>
      </div>

      <Tabs value={queue} onValueChange={(v) => setQueue(v as typeof queue)}>
        <TabsList>
          <TabsTrigger value="production">Production Queue</TabsTrigger>
          <TabsTrigger value="design">Design Queue</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="shadow-card">
        <CardContent className="p-4 flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by case number or restoration…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {queue === "production" && (
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="lg:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : INTERNAL_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Case", "Restoration", "Teeth", "Model", "Status", "Due", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      {queue === "design" ? "No cases in your design queue." : "No cases assigned yet."}
                    </td>
                  </tr>
                ) : list.map((c) => (
                  <tr key={c.caseId} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium text-primary">{c.caseNumber ?? c.caseId}</td>
                    <td className="px-4 py-3">
                      <p className="text-foreground">{c.subCategory ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{c.category}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.toothNumbers.length ? `#${c.toothNumbers.join(", #")}` : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.modelRequired ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">
                      {c.queue === "production" && c.millingStatus ? (
                        <MillingStatusBadge status={c.millingStatus} />
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap bg-primary/10 text-primary border border-primary/20">
                          {designStatusLabel(c.status)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.dueDate ? new Date(c.dueDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => router.push(`/milling/cases/${c.caseId}`)}>Open</Button>
                        {c.queue === "production" && (
                          <Button size="sm" variant="ghost" title="Download design files"><Download className="h-3.5 w-3.5" /></Button>
                        )}
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
  );
}
