"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { AdminLayout } from "@/src/components/AdminLayout"
import { Card, CardContent } from "@/src/components/ui/card"
import { Input } from "@/src/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { StatusBadge } from "@/src/components/StatusBadge"
import { Search } from "lucide-react"

type CaseRecord = {
  id: string
  caseNumber: string | null
  category: string | null
  subTypeData: Record<string, unknown> | null
  status: string
  createdAt: string
}

const statusFilters = [
  "All",
  "scan_received",
  "allocated_to_designer",
  "scan_verified",
  "scan_not_verified",
  "in_progress",
  "internal_qc",
  "submitted_to_client",
  "on_hold",
  "client_feedback",
  "approved",
  "delivered",
]

function renderSubTypeSummary(subTypeData: Record<string, unknown> | null) {
  if (!subTypeData) return "—"

  const values = Object.entries(subTypeData)
    .filter(([key, value]) => key !== "teeth" && key !== "toothSystem" && key !== "notes" && key !== "modelRequired" && typeof value === "string" && value)
    .map(([, value]) => value as string)

  return values.length ? values.join(" - ") : "—"
}

export default function AdminCasesPage() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")

  const { data, isLoading, error } = useQuery<{ data: CaseRecord[] }>({
    queryKey: ["admin-cases"],
    queryFn: async () => {
      const res = await fetch("/api/cases")
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to load cases")
      }
      return res.json()
    },
  })

  const filtered = useMemo(() => {
    const cases = data?.data || []
    const term = search.toLowerCase()

    return cases.filter((caseItem) => {
      const restoration = renderSubTypeSummary(caseItem.subTypeData).toLowerCase()
      const matchesSearch =
        !term ||
        (caseItem.caseNumber || caseItem.id).toLowerCase().includes(term) ||
        (caseItem.category || "").toLowerCase().includes(term) ||
        restoration.includes(term)

      const matchesStatus = statusFilter === "All" || caseItem.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [data, search, statusFilter])

  return (
    <AdminLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Cases</h1>
          <p className="text-sm text-muted-foreground mt-1">Click any row to view case details.</p>
        </div>

        <Card className="shadow-card border-border/50">
          <CardContent className="p-4 flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by case number, category or subtype..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full lg:w-60">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {statusFilters.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status === "All" ? "All Statuses" : status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Case ID", "Category", "Case Sub Type", "Teeth", "Status", "Created"].map((heading) => (
                      <th key={heading} className="text-left px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-40" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-16" /></td>
                        <td className="px-6 py-4"><div className="h-6 bg-muted rounded-full w-28" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-20" /></td>
                      </tr>
                    ))
                  ) : error ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-sm text-red-500">
                        {(error as Error).message}
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-sm text-muted-foreground">
                        No cases found.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((caseItem) => {
                      const toothNumbers = (caseItem.subTypeData?.teeth as number[]) || [];
                      const toothSystem = (caseItem.subTypeData?.toothSystem as string) || "USA";
                      return (
                        <tr
                          key={caseItem.id}
                          className="hover:bg-muted/20 transition-colors cursor-pointer"
                          onClick={() => router.push(`/admin/cases/${caseItem.id}`)}
                        >
                          <td className="px-6 py-4 font-semibold text-primary">{caseItem.caseNumber || caseItem.id}</td>
                          <td className="px-6 py-4 text-foreground">{caseItem.category || "—"}</td>
                          <td className="px-6 py-4 text-muted-foreground">{renderSubTypeSummary(caseItem.subTypeData)}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">{toothNumbers.length ? `#${toothNumbers.join(", #")} (${toothSystem})` : "—"}</td>
                          <td className="px-6 py-4"><StatusBadge status={caseItem.status} /></td>
                          <td className="px-6 py-4 text-muted-foreground">
                            {new Date(caseItem.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  )
}
