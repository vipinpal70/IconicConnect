"use client"

import { Button, Input, NumberInput, Table, Tooltip, Whisper } from 'rsuite'
import type { ReactNode } from 'react'

export interface PriceListRow {
  id: string
  serviceName: string
  subCategory: string
  price: number
  notes: string | null
  sortOrder: number
}

type Props = {
  items: PriceListRow[]
  editable?: boolean
  onChangeRow?: (id: string, field: 'serviceName' | 'subCategory' | 'price' | 'notes', value: string | number) => void
  onAddRow?: () => void
  onRemoveRow?: (id: string) => void
  emptyState?: ReactNode
}

const { Column, HeaderCell, Cell } = Table

function ServiceNameCell({ rowData, editable, onChangeRow, ...rest }: any) {
  return (
    <Cell {...rest}>
      {editable ? (
        <Input
          value={rowData.serviceName}
          onChange={(value) => onChangeRow?.(rowData.id, 'serviceName', value)}
          placeholder="Category name"
          size="sm"
        />
      ) : (
        <span className="font-medium text-[12px]">{rowData.serviceName}</span>
      )}
    </Cell>
  )
}

function SubCategoryCell({ rowData, editable, onChangeRow, ...rest }: any) {
  return (
    <Cell {...rest}>
      {editable ? (
        <Input
          value={rowData.subCategory ?? ''}
          onChange={(value) => onChangeRow?.(rowData.id, 'subCategory', value)}
          placeholder="Sub category name"
          size="sm"
        />
      ) : (
        <span className="font-medium text-[12px]">{rowData.subCategory || '—'}</span>
      )}
    </Cell>
  )
}

function PriceCell({ rowData, editable, onChangeRow, ...rest }: any) {
  return (
    <Cell {...rest}>
      {editable ? (
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
        <span className="font-medium text-[12px]">${Number(rowData.price).toFixed(2)}</span>
      )}
    </Cell>
  )
}

function NotesCell({ rowData, editable, onChangeRow, ...rest }: any) {
  const text = rowData.notes || ''
  return (
    <Cell {...rest}>
      {editable ? (
        <Input
          value={text}
          onChange={(value) => onChangeRow?.(rowData.id, 'notes', value)}
          placeholder="Optional notes"
          size="sm"
        />
      ) : text ? (
        <Whisper
          placement="topStart"
          trigger="hover"
          speaker={
            <Tooltip style={{ maxWidth: 320 }}>
              {text}
            </Tooltip>
          }
        >
          <span
            className="text-[12px] text-muted-foreground cursor-default block truncate"
            style={{ maxWidth: '100%' }}
          >
            {text}
          </span>
        </Whisper>
      ) : (
        <span className="text-[12px] text-muted-foreground">—</span>
      )}
    </Cell>
  )
}

function RemoveCell({ rowData, onRemoveRow, ...rest }: any) {
  return (
    <Cell {...rest}>
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
    </Cell>
  )
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
    <Table
      data={items}
      autoHeight
      cellBordered
      hover
      rowHeight={45}
      headerHeight={38}
    >
      <Column flexGrow={1} minWidth={140}>
        <HeaderCell>Category</HeaderCell>
        <ServiceNameCell editable={editable} onChangeRow={onChangeRow} />
      </Column>

      <Column flexGrow={1} minWidth={140}>
        <HeaderCell>Sub Category</HeaderCell>
        <SubCategoryCell editable={editable} onChangeRow={onChangeRow} />
      </Column>

      <Column width={110}>
        <HeaderCell>Price</HeaderCell>
        <PriceCell editable={editable} onChangeRow={onChangeRow} />
      </Column>

      <Column flexGrow={2} minWidth={180}>
        <HeaderCell>Notes</HeaderCell>
        <NotesCell editable={editable} onChangeRow={onChangeRow} />
      </Column>

      {editable && (
        <Column width={100} fixed="right">
          <HeaderCell>
            <div className="flex items-center">
              <Button appearance="ghost" size="sm" onClick={onAddRow} disabled={!onAddRow}>
                Add row
              </Button>
            </div>
          </HeaderCell>
          <RemoveCell onRemoveRow={onRemoveRow} />
        </Column>
      )}
    </Table>
  )
}
