"use client"

import { Input } from "@/src/components/ui/input"
import { Switch } from "@/src/components/ui/switch"
import { Badge } from "@/src/components/ui/badge"
import type { PriceListEntryFull } from "@/src/lib/price-list-shared"

// One tab = one service flow, so each row is a single flat catalog/client
// entry (not a merged multi-flow row) — see service-catlog-manage-plan.md §5.
export type PriceRowMode = "system" | "client"

type Props = {
  rows: PriceListEntryFull[]
  mode: PriceRowMode
  onChangePrice?: (catalogItemId: string, price: number) => void
  onToggleEnabled?: (catalogItemId: string, enabled: boolean) => void
}

const UNIT_LABELS: Record<string, string> = {
  per_tooth: 'per tooth',
  per_arch: 'per arch',
  per_case: 'per case',
}

export function PriceListTable({ rows, mode, onChangePrice, onToggleEnabled }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-xs text-muted-foreground text-center">
        No price list available.
      </div>
    )
  }

  const grouped = rows.reduce<Record<string, PriceListEntryFull[]>>((acc, row) => {
    ;(acc[row.category] ??= []).push(row)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([category, categoryRows]) => (
        <div key={category}>
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1.5 px-0.5">
            {category}
          </p>
          <table className="w-full text-xs border border-border/40 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-muted/40 border-b border-border/40">
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Service</th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-20">Unit</th>
                {mode === "client" && (
                  <>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground w-28">Default Price</th>
                    <th className="text-center px-3 py-2 font-semibold text-muted-foreground w-28">System Enabled</th>
                  </>
                )}
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground w-24">
                  {mode === "system" ? "Enabled" : "Client Enabled"}
                </th>
                <th className="text-right px-3 py-2 font-semibold text-muted-foreground w-32">
                  {mode === "system" ? "Default Price" : "Client Price"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {categoryRows.map((row) => {
                const systemLocked = mode === "client" && !row.isActive
                const priceDisabled = mode === "system" ? !row.isActive : (systemLocked || !row.isEnabled)

                return (
                  <tr key={row.catalogItemId} className={`hover:bg-muted/10 transition-colors ${systemLocked ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2 font-medium text-foreground">{row.subCategory}</td>
                    <td className="px-3 py-2 text-muted-foreground">{UNIT_LABELS[row.unitType] ?? row.unitType}</td>

                    {mode === "client" && (
                      <>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          ${Number(row.defaultPrice).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant={row.isActive ? "secondary" : "outline"} className="text-[10px]">
                            {row.isActive ? "On" : "Off"}
                          </Badge>
                        </td>
                      </>
                    )}

                    <td className="px-3 py-2">
                      <div className="flex justify-center">
                        <Switch
                          checked={mode === "system" ? row.isActive : row.isEnabled}
                          disabled={systemLocked || !onToggleEnabled}
                          onCheckedChange={(checked) => onToggleEnabled?.(row.catalogItemId, checked)}
                        />
                      </div>
                    </td>

                    <td className="px-3 py-2 text-right">
                      {onChangePrice && !priceDisabled ? (
                        <div className="flex justify-end items-center gap-1">
                          <span className="text-muted-foreground text-xs">$</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={mode === "system" ? row.defaultPrice : row.price}
                            onChange={(e) => {
                              const raw = parseFloat(e.target.value)
                              const val = isNaN(raw) ? 0 : Math.max(0, raw)
                              onChangePrice(row.catalogItemId, val)
                            }}
                            onBlur={(e) => {
                              const raw = parseFloat(e.target.value)
                              const val = isNaN(raw) ? 0 : Math.max(0, parseFloat(raw.toFixed(2)))
                              onChangePrice(row.catalogItemId, val)
                            }}
                            className="h-7 w-24 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </div>
                      ) : (
                        <span className="font-semibold text-foreground">
                          ${Number(mode === "system" ? row.defaultPrice : row.price).toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}