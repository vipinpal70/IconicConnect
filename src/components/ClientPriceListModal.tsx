"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog'
import { Button } from '@/src/components/ui/button'
import { PriceListTable } from './PriceListTable'
import type { PriceListEntryFull } from '@/src/lib/price-list-shared'
import { FileText, RefreshCw } from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
  clientName: string
  // Only rows already filtered to isActive && isEnabled should be passed in
  // (see client profile page).
  rows: PriceListEntryFull[]
  loading?: boolean
  onRefresh?: () => void
  refreshing?: boolean
}

export function ClientPriceListModal({ open, onClose, clientName, rows, loading, onRefresh, refreshing }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-primary" />
              Allocated Price List — {clientName}
            </DialogTitle>
            {onRefresh && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1.5 shrink-0"
                onClick={onRefresh}
                disabled={refreshing}
                title="Bypass cache and reload directly from the database"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="mt-1">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No services enabled on your account yet.</p>
          ) : (
            <>
              <PriceListTable rows={rows} mode="client" />
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
