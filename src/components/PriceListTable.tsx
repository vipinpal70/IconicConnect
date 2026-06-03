"use client"

import { NumberInput } from 'rsuite'

export interface PriceListRow {
  id: string
  catalogItemId: string
  category: string
  subCategory: string
  unitType: 'per_tooth' | 'per_arch'
  defaultPrice: number
  price: number
  notes: string | null
  sortOrder: number
}

type Props = {
  items: PriceListRow[]
  editable?: boolean
  onChangePrice?: (catalogItemId: string, price: number) => void
}

const UNIT_LABELS: Record<string, string> = {
  per_tooth: 'per tooth',
  per_arch: 'per arch',
}

export function PriceListTable({ items, editable = false, onChangePrice }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-xs text-muted-foreground text-center">
        No price list available.
      </div>
    )
  }

  const grouped = items.reduce<Record<string, PriceListRow[]>>((acc, item) => {
    ;(acc[item.category] ??= []).push(item)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([category, rows]) => (
        <div key={category}>
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1.5 px-0.5">
            {category}
          </p>
          <table className="w-full text-xs border border-border/40 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-muted/40 border-b border-border/40">
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Service</th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-24">Unit</th>
                {editable && (
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground w-24">Default</th>
                )}
                <th className="text-right px-3 py-2 font-semibold text-muted-foreground w-32">
                  {editable ? 'Client Price' : 'Price'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/10 transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground">{row.subCategory}</td>
                  <td className="px-3 py-2 text-muted-foreground">{UNIT_LABELS[row.unitType] ?? row.unitType}</td>
                  {editable && (
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      ${Number(row.defaultPrice).toFixed(2)}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    {editable ? (
                      <div className="flex justify-end">
                        <NumberInput
                          value={row.price}
                          onChange={(value) => onChangePrice?.(row.catalogItemId, Number(value ?? 0))}
                          prefix="$"
                          min={0}
                          step={0.5}
                          size="xs"
                          style={{ width: 110 }}
                        />
                      </div>
                    ) : (
                      <span className="font-semibold text-foreground">
                        ${Number(row.price).toFixed(2)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
