"use client"

import { useEffect, useRef } from "react"
import { Search, X, RefreshCw, SlidersHorizontal } from "lucide-react"
import { Input } from "@/src/components/ui/input"
import { Button } from "@/src/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import type { Filters } from "./useClientFilters"

export type Facets = { status: Record<string, number>; plan: Record<string, number> }

type Props = {
  filters: Filters
  input: string
  onInput: (v: string) => void
  onChange: (patch: Partial<Filters>) => void
  onClear: () => void
  activeCount: number
  facets?: Facets
  onRefresh: () => void
  refreshing: boolean
}

const STATUS_CHIPS = [
  { value: undefined, label: "All" },
  { value: "pending", label: "Pending approval" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const

const PLAN_CHIPS = [
  { value: undefined, label: "Any plan" },
  { value: "trial", label: "Trial" },
  { value: "onboarded", label: "Onboarded" },
] as const

function Chip({ active, children, count, onClick, attention }: {
  active: boolean; children: React.ReactNode; count?: number; onClick: () => void; attention?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      {children}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 text-[10px] tabular-nums ${
            active ? "bg-primary-foreground/20" : attention && count > 0 ? "bg-amber-500/15 text-amber-600" : "bg-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function ClientFilters({ filters, input, onInput, onChange, onClear, activeCount, facets, onRefresh, refreshing }: Props) {
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" focuses search from anywhere (unless already typing in a field) — the convention of Gmail/GitHub/Docs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const statusTotal = facets ? Object.values(facets.status).reduce((a, b) => a + b, 0) : undefined

  return (
    <div className="space-y-2.5" role="search" aria-label="Filter clients">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { onInput(""); (e.target as HTMLInputElement).blur() } }}
            placeholder="Search lab, contact, email, city or phone…"
            aria-label="Search clients"
            maxLength={100}
            className="h-9 pl-8 pr-14 text-xs"
          />
          {input ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground sm:block">/</kbd>
          )}
        </div>

        <Select value={filters.payment ?? "any"} onValueChange={(v) => onChange({ payment: v === "any" ? undefined : (v as Filters["payment"]) })}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Filter by payment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any" className="text-xs">Any payment</SelectItem>
            <SelectItem value="unpaid" className="text-xs">Has unpaid invoices</SelectItem>
            <SelectItem value="paid" className="text-xs">All invoices paid</SelectItem>
            <SelectItem value="none" className="text-xs">No invoices yet</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.sort} onValueChange={(v) => onChange({ sort: v as Filters["sort"] })}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Sort clients">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest" className="text-xs">Newest first</SelectItem>
            <SelectItem value="oldest" className="text-xs">Oldest first</SelectItem>
            <SelectItem value="name" className="text-xs">Name (A–Z)</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={onRefresh} disabled={refreshing} title="Reload the list">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status">
          {STATUS_CHIPS.map((c) => (
            <Chip
              key={c.label}
              active={filters.status === c.value}
              count={c.value ? facets?.status[c.value] : statusTotal}
              attention={c.value === "pending"}
              onClick={() => onChange({ status: c.value })}
            >
              {c.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Plan">
          {PLAN_CHIPS.map((c) => (
            <Chip key={c.label} active={filters.plan === c.value} count={c.value ? facets?.plan[c.value] : undefined} onClick={() => onChange({ plan: c.value })}>
              {c.label}
            </Chip>
          ))}
        </div>
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
            <SlidersHorizontal className="h-3 w-3" />
            Clear {activeCount} filter{activeCount > 1 ? "s" : ""}
          </button>
        )}
      </div>
    </div>
  )
}
