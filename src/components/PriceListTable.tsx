"use client"

import { Button, Input, NumberInput, Table } from 'rsuite'
import type { ReactNode } from 'react'

export interface PriceListRow {
  id: string
  serviceName: string
  price: number
  notes: string | null
  sortOrder: number
}

type Props = {
  items: PriceListRow[]
  editable?: boolean
  onChangeRow?: (id: string, field: 'serviceName' | 'price' | 'notes', value: string | number) => void
  onAddRow?: () => void
  onRemoveRow?: (id: string) => void
  emptyState?: ReactNode
}

export function PriceListTable({
  items,
  editable = false,
  onChangeRow,
  onAddRow,
  onRemoveRow,
  emptyState,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
        {emptyState ?? 'No price list services have been added yet.'}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <Table
        data={items}
        autoHeight
        bordered
        cellBordered
        hover
        rowHeight={60}
        headerHeight={44}
      >
        <Table.Column flexGrow={2} minWidth={220}>
          <Table.HeaderCell>Service</Table.HeaderCell>
          <Table.Cell>
            {(rowData: PriceListRow) =>
              editable ? (
                <Input
                  value={rowData.serviceName}
                  onChange={(value) => onChangeRow?.(rowData.id, 'serviceName', value)}
                  placeholder="Service name"
                  size="sm"
                />
              ) : (
                <span className="font-medium text-foreground">{rowData.serviceName}</span>
              )
            }
          </Table.Cell>
        </Table.Column>

        <Table.Column width={180}>
          <Table.HeaderCell>Price</Table.HeaderCell>
          <Table.Cell>
            {(rowData: PriceListRow) =>
              editable ? (
                <NumberInput
                  value={rowData.price}
                  onChange={(value) => onChangeRow?.(rowData.id, 'price', Number(value ?? 0))}
                  prefix="$"
                  min={0}
                  step={1}
                  size="sm"
                  className="w-full"
                />
              ) : (
                <span className="font-medium text-foreground">${rowData.price.toFixed(2)}</span>
              )
            }
          </Table.Cell>
        </Table.Column>

        <Table.Column flexGrow={2} minWidth={220}>
          <Table.HeaderCell>Notes</Table.HeaderCell>
          <Table.Cell>
            {(rowData: PriceListRow) =>
              editable ? (
                <Input
                  value={rowData.notes ?? ''}
                  onChange={(value) => onChangeRow?.(rowData.id, 'notes', value)}
                  placeholder="Optional notes"
                  size="sm"
                />
              ) : (
                <span className="text-sm text-muted-foreground">{rowData.notes || '-'}</span>
              )
            }
          </Table.Cell>
        </Table.Column>

        {editable && (
          <Table.Column width={120} fixed="right">
            <Table.HeaderCell className="text-right">
              <div className="flex items-center">
                <Button appearance="ghost" size="sm" onClick={onAddRow} disabled={!onAddRow}>
                  Add row
                </Button>
              </div>
            </Table.HeaderCell>
            <Table.Cell>
              {(rowData: PriceListRow) => (
                <div className="flex items-center">
                  <Button
                    appearance="ghost"
                    color="red"
                    size="sm"
                    onClick={() => onRemoveRow?.(rowData.id)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </Table.Cell>
          </Table.Column>
        )}
      </Table>
    </div>
  )
}