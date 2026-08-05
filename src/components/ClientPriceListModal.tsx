"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/src/components/ui/tabs'
import { PriceListTable } from './PriceListTable'
import type { PriceListEntryFull } from '@/src/lib/price-list-shared'
import type { ServiceType } from '@/src/lib/case-status-mapping'
import { FileText } from 'lucide-react'

const FLOW_LABELS: Record<ServiceType, string> = {
  design_only: 'Design Only',
  design_milling: 'Design + Milling',
  milling_only: 'Milling Only',
}

type Props = {
  open: boolean
  onClose: () => void
  clientName: string
  // One entry per flow the client has enabled — only rows already filtered
  // to isActive && isEnabled should be passed in (see client profile page).
  rowsByFlow: Partial<Record<ServiceType, PriceListEntryFull[]>>
  loading?: boolean
}

export function ClientPriceListModal({ open, onClose, clientName, rowsByFlow, loading }: Props) {
  const flows = (Object.keys(rowsByFlow) as ServiceType[]).filter((flow) => rowsByFlow[flow] !== undefined)

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
          ) : flows.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No services enabled on your account yet.</p>
          ) : flows.length === 1 ? (
            <>
              <PriceListTable rows={rowsByFlow[flows[0]] ?? []} mode="client" />
              <p className="text-[10px] text-muted-foreground mt-3 italic">
                Price list updates made by our team are reflected here automatically.
              </p>
            </>
          ) : (
            <Tabs defaultValue={flows[0]}>
              <TabsList>
                {flows.map((flow) => (
                  <TabsTrigger key={flow} value={flow} className="text-xs">
                    {FLOW_LABELS[flow]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {flows.map((flow) => (
                <TabsContent key={flow} value={flow}>
                  <PriceListTable rows={rowsByFlow[flow] ?? []} mode="client" />
                </TabsContent>
              ))}
              <p className="text-[10px] text-muted-foreground mt-3 italic">
                Price list updates made by our team are reflected here automatically.
              </p>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}