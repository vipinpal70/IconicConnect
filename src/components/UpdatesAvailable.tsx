"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/src/components/ui/button"

/** Shown above a filtered cases list when a refresh would show more. */
export function UpdatesAvailable({ show, busy, onRefresh }: { show: boolean; busy?: boolean; onRefresh: () => void }) {
  return (
    <div role="status">
      {show && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <span>Updates available: the list has changed since it was loaded.</span>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={onRefresh} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
            Refresh
          </Button>
        </div>
      )}
    </div>
  )
}
