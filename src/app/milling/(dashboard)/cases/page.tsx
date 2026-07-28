"use client"

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
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
  millingStatus: MillingStatus;
}

const STATUS_FILTERS: ("all" | MillingStatus)[] = ["all", ...millingStatusEnum.enumValues];

export default function MillingCasesPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | MillingStatus>("all");

  const { data: cases = [], isLoading } = useQuery<MillingCaseRow[]>({
    queryKey: ["milling-cases", status],
    queryFn: async () => {
      const params = status !== "all" ? `?status=${status}` : "";
      const res = await fetch(`/api/milling/cases${params}`);
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

      <Card className="shadow-card">
        <CardContent className="p-4 flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by case number or restoration…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="lg:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : INTERNAL_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No cases assigned yet.</td></tr>
                ) : list.map((c) => (
                  <tr key={c.caseId} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium text-primary">{c.caseNumber ?? c.caseId}</td>
                    <td className="px-4 py-3">
                      <p className="text-foreground">{c.subCategory ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{c.category}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.toothNumbers.length ? `#${c.toothNumbers.join(", #")}` : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.modelRequired ? "Yes" : "No"}</td>
                    <td className="px-4 py-3"><MillingStatusBadge status={c.millingStatus} /></td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.dueDate ? new Date(c.dueDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => router.push(`/milling/cases/${c.caseId}`)}>Open</Button>
                        <Button size="sm" variant="ghost" title="Download design files"><Download className="h-3.5 w-3.5" /></Button>
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
