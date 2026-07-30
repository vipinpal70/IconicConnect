"use client"

import { Input } from "@/src/components/ui/input"
import type { MergedPriceRow } from "@/src/lib/price-list-shared"

export type PriceColumnKey = "defaultDesign" | "defaultMilling" | "clientDesign" | "clientMilling"

export interface PriceColumnConfig {
  key: PriceColumnKey
  label: string
  editable?: boolean
}

type Props = {
  rows: MergedPriceRow[]
  columns: PriceColumnConfig[]
  onChangePrice?: (catalogItemId: string, price: number) => void
}

const UNIT_LABELS: Record<string, string> = {
  per_tooth: 'per tooth',
  per_arch: 'per arch',
  per_case: 'per case',
}

function cellFor(row: MergedPriceRow, key: PriceColumnKey): { catalogItemId: string; value: number } | null {
  switch (key) {
    case "defaultDesign":
      return row.designOnly ? { catalogItemId: row.designOnly.catalogItemId, value: row.designOnly.defaultPrice } : null
    case "defaultMilling":
      return row.designMilling ? { catalogItemId: row.designMilling.catalogItemId, value: row.designMilling.defaultPrice } : null
    case "clientDesign":
      return row.designOnly ? { catalogItemId: row.designOnly.catalogItemId, value: row.designOnly.price } : null
    case "clientMilling":
      return row.designMilling ? { catalogItemId: row.designMilling.catalogItemId, value: row.designMilling.price } : null
  }
}

export function PriceListTable({ rows, columns, onChangePrice }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-xs text-muted-foreground text-center">
        No price list available.
      </div>
    )
  }

  const grouped = rows.reduce<Record<string, MergedPriceRow[]>>((acc, row) => {
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
                {columns.map((col) => (
                  <th key={col.key} className="text-right px-3 py-2 font-semibold text-muted-foreground w-32">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {categoryRows.map((row) => (
                <tr key={`${row.category}-${row.subCategory}`} className="hover:bg-muted/10 transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground">{row.subCategory}</td>
                  <td className="px-3 py-2 text-muted-foreground">{UNIT_LABELS[row.unitType] ?? row.unitType}</td>
                  {columns.map((col) => {
                    const cell = cellFor(row, col.key)
                    return (
                      <td key={col.key} className="px-3 py-2 text-right">
                        {cell === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : col.editable ? (
                          <div className="flex justify-end items-center gap-1">
                            <span className="text-muted-foreground text-xs">$</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={cell.value}
                              onChange={(e) => {
                                const raw = parseFloat(e.target.value)
                                const val = isNaN(raw) ? 0 : Math.max(0, raw)
                                onChangePrice?.(cell.catalogItemId, val)
                              }}
                              onBlur={(e) => {
                                const raw = parseFloat(e.target.value)
                                const val = isNaN(raw) ? 0 : Math.max(0, parseFloat(raw.toFixed(2)))
                                onChangePrice?.(cell.catalogItemId, val)
                              }}
                              className="h-7 w-24 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                        ) : (
                          <span className="font-semibold text-foreground">
                            ${Number(cell.value).toFixed(2)}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}