# Client-interface bug fixes — implementation plan

Scope: **client interface only**. Three unrelated fixes, each independently shippable.

---

## 1. Hard refresh for the allocated price list (client profile)

**Where:** `src/app/client/(dashboard)/profile/page.tsx:47-78` loads `priceListByFlow` once on mount via `fetchPriceListWithCache()` (`src/lib/price-list-cache.ts`) and passes it to `ClientPriceListModal` (`src/components/ClientPriceListModal.tsx`). There's currently no way to force a re-fetch — the modal just shows whatever was loaded at mount.

**Why it's stale in practice:** `fetchPriceListWithCache` layers two caches before ever hitting the network — `sessionStorage` (10 min TTL) and `localStorage` (1 hour TTL) (`price-list-cache.ts:9-10`). Even bypassing those, the API route itself (`src/app/api/client/price-list/route.ts:34-40`) has a **third** cache layer (Redis, 1 hour TTL, key `price-list:client:<id>:<serviceType>`) — but that route already accepts `?refresh=true` to skip straight to `getPriceListForClient()` and re-populate the cache. So admin edits to a client's allocated prices can be invisible to that client for up to an hour across three cache layers, with no manual escape hatch today.

**Fix:**
- Add a `RefreshCw` icon button to `ClientPriceListModal`'s header (same visual pattern as the admin "Refresh from DB" buttons in `src/app/admin/(dashboard)/profile/page.tsx:210-221` and the milling centre catalog's hard-refresh button I added earlier in `src/components/MillingServiceCatalogTable.tsx`) — spinning icon while in flight, disabled during refresh.
- New prop on `ClientPriceListModal`: `onRefresh?: () => void` and `refreshing?: boolean`, rendered next to the `DialogTitle`.
- In `profile/page.tsx`, a `handleRefreshPriceList` function that, per enabled flow: calls `invalidatePriceListCache(profile.id, flow)` (already exists, `price-list-cache.ts:70-77`) then re-fetches `/api/client/price-list?serviceType=<flow>&refresh=true` with `cache: "no-store"`, filters to `isEnabled` rows (same rule already applied at load time, `profile/page.tsx:70-74`), and updates `priceListByFlow` state directly (bypassing `fetchPriceListWithCache` so the fresh network response also re-primes session/local storage — reuse `fetchPriceListWithCache`'s write path isn't exposed, so this handler writes straight to state and lets the next natural cache read pick up whatever's freshest, or simpler: just call `fetchPriceListWithCache` again immediately after `invalidatePriceListCache`, since with the browser caches cleared it will fall through to the network call).
- Toast on success/failure, matching existing conventions elsewhere in the app.

**Files touched:**
- `src/components/ClientPriceListModal.tsx` — add refresh button + props
- `src/app/client/(dashboard)/profile/page.tsx` — add refresh handler, pass props through

---

## 2. Case ID should be a real link (right-click → open in new tab)

**Where:** `src/app/client/(dashboard)/cases/page.tsx:1730-1734` — the entire `<tr>` navigates via `onClick={() => router.push(`/client/cases/${c.id}`)}`. There's no `<a>`/`<Link>` anywhere in the row, so the browser has nothing to attach "Open link in new tab" / "Copy link" to on right-click, and middle-click / Cmd+click don't open a new tab either.

**Reference pattern already in the codebase:** `src/app/admin/(dashboard)/cases/page.tsx:1073-1078` wraps just the case-number cell in a real `next/link` `<Link href={`/admin/cases/${caseItem.id}`}>`, while the row itself has no onClick (row-wide click-to-navigate isn't used on the admin page at all). The client page currently has row-wide click-to-navigate as a convenience — this fix keeps that but makes the Case ID specifically a real link too, so right-click/middle-click/Cmd+click all work from that cell without losing the "click anywhere in the row" convenience elsewhere.

**Fix:**
- Import `Link` from `next/link`.
- In the Case ID cell (`page.tsx:1735-1759`), wrap the `<span className="font-semibold text-[11px] text-slate-800">{c.caseNumber || c.id}</span>` in `<Link href={`/client/cases/${c.id}`} className="hover:underline">`.
- The row's existing `onClick` stays for clicking elsewhere in the row (chat icon aside — that already has its own click target). No `stopPropagation` needed on the Link: a normal left-click on it navigates via the anchor and the bubbled row `onClick` fires `router.push` to the same URL immediately after, which is a harmless no-op (same route); right-click, middle-click, and Cmd/Ctrl-click on the Link don't trigger a `click` event at all, so the row handler never fires for those and the browser's native "open in new tab" works correctly.

**Files touched:**
- `src/app/client/(dashboard)/cases/page.tsx`

---

## 3. Milling indicator icon on the client cases table

**Where:** Admin's cases table already flags Design+Milling / Milling Only cases with a small icon badge next to the status pill — `src/app/admin/(dashboard)/cases/page.tsx:1121-1133`:
```tsx
{(caseItem.serviceType === "design_milling" || caseItem.serviceType === "milling_only") && (
  <span title={caseItem.serviceType === "milling_only" ? "Milling Only" : "Design + Milling"} className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary/10 text-primary shrink-0">
    <Factory className="h-2.5 w-2.5" />
  </span>
)}
```
(`Factory` from `lucide-react`.) The client cases table's Status cell (`src/app/client/(dashboard)/cases/page.tsx:1781-1785`) only renders `<StatusBadge>`, with no equivalent indicator — a client currently has no at-a-glance way to tell which of their cases involve milling from the table view.

**Fix:**
- Import `Factory` from `lucide-react` in `client/(dashboard)/cases/page.tsx`.
- In the Status cell, add the identical badge (same condition, same title text, same classes) next to `<StatusBadge>`, wrapped in the same `flex items-center gap-1.5` container the admin page uses (`admin/cases/page.tsx:1122`) so it sits inline instead of stacking.

**Files touched:**
- `src/app/client/(dashboard)/cases/page.tsx`

---

## Build order

| Order | Fix | Why |
|---|---|---|
| 1 | #3 milling icon | Smallest, purely additive, no shared-component changes |
| 2 | #2 case ID link | Small, single file |
| 3 | #1 price-list hard refresh | Touches a shared component (`ClientPriceListModal`) used only here today, but worth doing last since it's the most involved of the three |

## Out of scope

- Not touching the admin or milling-portal cases tables — both already have (or don't need) equivalents of these fixes.
- Not adding a similar hard-refresh to the client's *client-facing* case list itself (separate from the price list) — not requested.
