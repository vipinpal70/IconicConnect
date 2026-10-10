"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

export const STATUSES = ["pending", "active", "inactive"] as const
export const PLANS = ["trial", "onboarded"] as const
export const PAYMENTS = ["unpaid", "paid", "none"] as const
export const SORTS = ["newest", "oldest", "name"] as const

export type Filters = {
  q: string
  status?: (typeof STATUSES)[number]
  plan?: (typeof PLANS)[number]
  payment?: (typeof PAYMENTS)[number]
  sort: (typeof SORTS)[number]
  page: number
}

const pick = <T extends readonly string[]>(list: T, v: string | null): T[number] | undefined =>
  v && (list as readonly string[]).includes(v) ? (v as T[number]) : undefined

const SEARCH_DEBOUNCE_MS = 300

/**
 * Filter state lives in the URL (?q=&status=&plan=&payment=&sort=&page=) — not component state — so a filtered
 * view survives refresh, works with back/forward and can be shared as a link. The search box keeps its own
 * text state and pushes it to the URL after a short pause, so typing never fires a request per keystroke.
 */
export function useClientFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const filters: Filters = useMemo(() => ({
    q: (sp.get("q") ?? "").slice(0, 100),
    status: pick(STATUSES, sp.get("status")),
    plan: pick(PLANS, sp.get("plan")),
    payment: pick(PAYMENTS, sp.get("payment")),
    sort: pick(SORTS, sp.get("sort")) ?? "newest",
    page: Math.max(parseInt(sp.get("page") ?? "1", 10) || 1, 1),
  }), [sp])

  const update = useCallback((patch: Partial<Filters>, keepPage = false) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      const empty = v === undefined || v === "" || (k === "sort" && v === "newest") || (k === "page" && v === 1)
      if (empty) next.delete(k)
      else next.set(k, String(v))
    }
    if (!keepPage && !("page" in patch)) next.delete("page") // any filter change returns to page 1
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  // ── search box: local text, debounced into the URL ──
  const [input, setInput] = useState(filters.q)
  const lastPushed = useRef(filters.q)

  useEffect(() => {
    if (input === filters.q) return
    const t = setTimeout(() => {
      lastPushed.current = input
      update({ q: input.trim() })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input, filters.q, update])

  // URL changed from outside (back button, clear-all, shared link): adopt it — but never overwrite what the
  // user is still typing (the URL briefly lags behind the input).
  useEffect(() => {
    if (filters.q !== lastPushed.current) {
      lastPushed.current = filters.q
      setInput(filters.q)
    }
  }, [filters.q])

  const activeCount = [filters.q, filters.status, filters.plan, filters.payment].filter(Boolean).length
  const clearAll = useCallback(() => {
    lastPushed.current = ""
    setInput("")
    update({ q: "", status: undefined, plan: undefined, payment: undefined, page: 1 })
  }, [update])

  return { filters, update, input, setInput, activeCount, clearAll }
}
