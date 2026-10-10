"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/src/components/ui/button"

/** 1 … 4 5 [6] 7 8 … 20 — always first, last and a window around the current page. */
function pageList(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set([1, total, current - 1, current, current + 1])
  if (current <= 3) [2, 3, 4].forEach((n) => set.add(n))
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => set.add(n))
  const sorted = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out: Array<number | "…"> = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("…")
    out.push(n)
  })
  return out
}

export function ClientPagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null
  return (
    <nav className="flex items-center justify-center gap-1 pt-2" aria-label="Pagination">
      <Button variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="h-3.5 w-3.5" /> Prev
      </Button>
      {pageList(page, pageCount).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
        ) : (
          <Button
            key={p}
            variant={p === page ? "default" : "ghost"}
            size="sm"
            aria-current={p === page ? "page" : undefined}
            className="h-8 min-w-8 px-2 text-xs tabular-nums"
            onClick={() => onPage(p)}
          >
            {p}
          </Button>
        ),
      )}
      <Button variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </nav>
  )
}
