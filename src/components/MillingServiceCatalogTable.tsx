"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Input } from "@/src/components/ui/input"
import { Switch } from "@/src/components/ui/switch"
import { Button } from "@/src/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { Trash2, Save, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { ServiceType } from "@/src/lib/case-status-mapping"

type CatalogRow = {
  id?: string
  category: string
  subCategory: string
  unitType: string
  partnerRate: number
  monthlyCapacity: number | null
  turnaroundDays: number | null
  isActive: boolean
}

type CatalogOption = {
  category: string
  subCategory: string
  unitType: string
}

const UNIT_LABELS: Record<string, string> = {
  per_tooth: "per tooth",
  per_arch: "per arch",
  per_case: "per case",
}

type RawCatalogRow = {
  id: string
  category: string
  subCategory: string
  unitType: string
  partnerRate: string | number
  monthlyCapacity: number | null
  turnaroundDays: number | null
  isActive: boolean
}

function mapRawRow(r: RawCatalogRow): CatalogRow {
  return {
    id: r.id,
    category: r.category,
    subCategory: r.subCategory,
    unitType: r.unitType,
    partnerRate: Number(r.partnerRate),
    monthlyCapacity: r.monthlyCapacity,
    turnaroundDays: r.turnaroundDays,
    isActive: r.isActive,
  }
}

async function fetchCenterCatalog(centerId: string, serviceType: ServiceType, hardRefresh = false): Promise<CatalogRow[]> {
  const res = await fetch(
    `/api/admin/milling/centers/${centerId}/service-catalog?serviceType=${serviceType}`,
    hardRefresh ? { cache: "no-store" } : undefined
  )
  if (!res.ok) throw new Error("Failed to load service catalog")
  const json = await res.json()
  return ((json.data ?? []) as RawCatalogRow[]).map(mapRawRow)
}

async function fetchCatalogOptions(serviceType: ServiceType): Promise<CatalogOption[]> {
  const res = await fetch(`/api/admin/service-catalog?serviceType=${serviceType}&includeInactive=true`)
  if (!res.ok) throw new Error("Failed to load catalog options")
  const json = await res.json()
  const seen = new Set<string>()
  const options: CatalogOption[] = []
  for (const r of json.data ?? []) {
    const key = `${r.category}::${r.subCategory}`
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ category: r.category, subCategory: r.subCategory, unitType: r.unitType })
  }
  return options
}

// Extracted from the step-2 catalog tabs so a future read-only "view centre"
// screen could reuse it — parametrized purely by centerId + serviceType.
export function MillingServiceCatalogTable({ centerId, serviceType }: { centerId: string; serviceType: ServiceType }) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<CatalogRow[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const queryKey = ["milling-center-catalog", centerId, serviceType]
  const catalogQuery = useQuery({ queryKey, queryFn: () => fetchCenterCatalog(centerId, serviceType) })
  const optionsQuery = useQuery({
    queryKey: ["admin-service-catalog-options", serviceType],
    queryFn: () => fetchCatalogOptions(serviceType),
  })

  // Seed the editable draft from the fetched rows exactly once (on first
  // load only) — updating state during render, per React's guidance for
  // deriving state from a prop/query without an effect-triggered re-render.
  const [seededFrom, setSeededFrom] = useState(catalogQuery.data)
  if (rows === null && catalogQuery.data && catalogQuery.data !== seededFrom) {
    setSeededFrom(catalogQuery.data)
    setRows(catalogQuery.data)
  }

  const usedKeys = new Set((rows ?? []).map((r) => `${r.category}::${r.subCategory}`))
  const availableOptions = (optionsQuery.data ?? []).filter((o) => !usedKeys.has(`${o.category}::${o.subCategory}`))

  const updateRow = (index: number, patch: Partial<CatalogRow>) => {
    setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev))
    setDirty(true)
  }

  const addRow = (option: CatalogOption) => {
    setRows((prev) => [
      ...(prev ?? []),
      { category: option.category, subCategory: option.subCategory, unitType: option.unitType, partnerRate: 0, monthlyCapacity: null, turnaroundDays: null, isActive: true },
    ])
    setDirty(true)
  }

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/admin/milling/centers/${centerId}/service-catalog/${itemId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete service")
    },
  })

  const removeRow = (index: number) => {
    const row = rows?.[index]
    if (!row) return
    if (row.id) {
      deleteMutation.mutate(row.id, {
        onSuccess: () => {
          setRows((prev) => (prev ? prev.filter((_, i) => i !== index) : prev))
          toast.success("Service removed")
        },
        onError: () => toast.error("Failed to remove service"),
      })
    } else {
      setRows((prev) => (prev ? prev.filter((_, i) => i !== index) : prev))
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/milling/centers/${centerId}/service-catalog?serviceType=${serviceType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rows ?? [] }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to save service catalog")
      }
      return (await res.json()).data as CatalogRow[]
    },
    onSuccess: (data) => {
      setRows(data)
      setDirty(false)
      queryClient.setQueryData(queryKey, data)
      toast.success("Service catalog saved")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const hardRefresh = async () => {
    if (dirty && !confirm("This discards any unsaved changes in this tab and reloads straight from the database. Continue?")) {
      return
    }
    setRefreshing(true)
    try {
      const fresh = await fetchCenterCatalog(centerId, serviceType, true)
      setRows(fresh)
      setDirty(false)
      queryClient.setQueryData(queryKey, fresh)
      toast.success("Refreshed directly from the database")
    } catch {
      toast.error("Failed to refresh")
    } finally {
      setRefreshing(false)
    }
  }

  if (catalogQuery.isLoading || rows === null) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button" size="sm" variant="ghost" className="h-7 text-xs gap-1.5"
          onClick={hardRefresh}
          disabled={refreshing}
          title="Bypass cache and reload directly from the database"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Hard refresh"}
        </Button>
      </div>

      <table className="w-full text-xs border border-border/40 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-muted/40 border-b border-border/40">
            <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Service</th>
            <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-20">Unit</th>
            <th className="text-right px-3 py-2 font-semibold text-muted-foreground w-28">Price</th>
            <th className="text-right px-3 py-2 font-semibold text-muted-foreground w-32">Monthly Capacity</th>
            <th className="text-center px-3 py-2 font-semibold text-muted-foreground w-20">Enabled</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No services added yet.</td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={row.id ?? `${row.category}::${row.subCategory}`} className="hover:bg-muted/10">
                <td className="px-3 py-2 font-medium text-foreground">{row.category} — {row.subCategory}</td>
                <td className="px-3 py-2 text-muted-foreground">{UNIT_LABELS[row.unitType] ?? row.unitType}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end items-center gap-1">
                    <span className="text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.partnerRate}
                      onChange={(e) => updateRow(index, { partnerRate: Math.max(0, parseFloat(e.target.value) || 0) })}
                      className="h-7 w-20 text-xs text-right"
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <Input
                    type="number"
                    min="0"
                    value={row.monthlyCapacity ?? ""}
                    onChange={(e) => updateRow(index, { monthlyCapacity: e.target.value === "" ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    placeholder="No cap"
                    className="h-7 w-24 text-xs text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-center">
                    <Switch checked={row.isActive} onCheckedChange={(v) => updateRow(index, { isActive: v })} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeRow(index)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="flex items-center justify-between gap-3">
        <Select
          onValueChange={(value) => {
            const option = availableOptions.find((o) => `${o.category}::${o.subCategory}` === value)
            if (option) addRow(option)
          }}
          value=""
          disabled={availableOptions.length === 0}
        >
          <SelectTrigger className="h-8 w-64 text-xs">
            <SelectValue placeholder={availableOptions.length === 0 ? "All services added" : "+ Add service"} />
          </SelectTrigger>
          <SelectContent>
            {availableOptions.map((o) => (
              <SelectItem key={`${o.category}::${o.subCategory}`} value={`${o.category}::${o.subCategory}`}>
                {o.category} — {o.subCategory}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
          <Save className="h-3.5 w-3.5" />
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}