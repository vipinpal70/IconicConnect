"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog'
import { PriceListTable, type PriceListRow } from './PriceListTable'
import { FileText } from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
  clientName: string
  items: PriceListRow[]
  loading?: boolean
}

export function ClientPriceListModal({ open, onClose, clientName, items, loading }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" />
            Allocated Price List — {clientName}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-1">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>
          ) : (
            <>
              <PriceListTable items={items} />
              <p className="text-[10px] text-muted-foreground mt-3 italic">
                Price list updates made by our team are reflected here automatically.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
