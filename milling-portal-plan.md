# Milling Centre Portal — Plan

**Status: DRAFT — awaiting approval. No code changed.**

Scope: everything a Milling Centre user sees and can do inside `/milling/**`. Builds directly
on `case-flow-update-plan.md` (the design-partner flow already shipped) and the earlier
`milling-implementation-plan.md` / `milling-center-admin-level-plan.md`. This plan is an audit
of what exists today plus a concrete proposal for UI, API, and logic improvements — nothing
here is implemented yet.

---

## 1. Guiding principles (unchanged, reaffirmed)

These are already load-bearing decisions from the two prior plans — every proposal below is
checked against them:

1. **A milling centre never sees dental-lab PII beyond ship-to name/address.** No client
   email, phone, or any pricing the lab is charged.
2. **A milling centre never sees Iconic's pricing or margin.** It sees its *own* rate
   (`milling_service_catalog.partnerRate`, admin-set per `milling-center-admin-level-plan.md`)
   and nothing else money-related — no client price, no computed margin, no other centres'
   rates.
3. **A milling centre cannot self-serve exceptions.** No `on_hold`, `cancelled`, or any
   client-facing status — it raises a support ticket instead (`case-flow-update-plan.md` §6.2).
4. **Everything is scoped to `profile.millingCenterId`.** No cross-centre visibility, enforced
   server-side in every route via `requireMillingUser`.
5. **Two legs, one portal.** A centre may be doing design work, production work, or both on
   the same case (Flow 1/2/3) — the UI must make which leg(s) it owns, and what's actionable
   right now, unambiguous.

---

## 2. Current state — full audit

### 2.1 Navigation (`src/components/MillingSidebar.tsx`)

Three items only: **Dashboard**, **Assigned Cases**, **Support**. No Services, no
Team/Account, no Profile/Settings page exists.

### 2.2 Dashboard (`/milling/dashboard`)

- 5 stat tiles: Design queue count, Ready for Milling, In Production, Milling QC, Shipped
  (`src/app/api/milling/dashboard/route.ts`).
- "Production summary" card: active case count, avg TAT (delivered cases only).
- Recent notifications (last 5, shared `/api/notifications`).
- One button: "Open case queue" → `/milling/cases`.

### 2.3 Cases list (`/milling/cases`)

- Two tabs added in the last round: **Production Queue** / **Design Queue**
  (`src/app/api/milling/cases/route.ts?queue=design|production`).
- Search by case number/restoration; production tab has a status filter.
- Columns: Case, Restoration, Teeth, Model, Status, Due, actions (Open, and a Download
  placeholder button on the production tab that does nothing — `<Download>` icon with no
  `onClick`).

### 2.4 Case detail (`/milling/cases/[id]`)

- Header: case number/restoration, ship-to/due summary, a design-stage badge or
  `MillingStatusBadge` depending on which leg is active.
- Case specs card: restoration, category, model required, teeth, due date, Iconic's notes,
  ship-to.
- **Design card** (only if `isDesignCentre`): input scan files (view only), Start Design /
  Resume Design, output-file + preview-file upload, Submit for Review, read-only banner at
  Internal QC.
- **Files card** (only if `isProductionCentre`): download the approved design package, upload
  manufacturing/QC photos.
- **Production status card**: a bare `<Select>` of every `millingStatusEnum` value + Save —
  no guardrails against skipping a stage (e.g. `ready_for_milling` → `delivered` directly is
  accepted with no confirmation).
- **Shipment card**: carrier + tracking number → "Generate shipment" (no shipment ETA field in
  the UI despite `shipmentEta` existing on the schema and being displayed nowhere).
- **Raise flag card**: two fire-and-forget buttons (clarification / technical issue) → creates
  a support ticket. No visibility into any *existing* ticket for this case, and no case
  linkage on the ticket beyond a free-text subject line.
- **Timeline card**: renders `cases.timeline` (already privacy-filtered server-side).

### 2.5 Support (`/milling/support`)

- Create a ticket (subject, message; category is only settable from the case-detail "flag"
  buttons, not from this page); list of the centre's tickets: number, subject, category,
  status, last update.
- **No detail view.** `adminNotes` (Iconic's reply) is fetched but never rendered — a centre
  cannot see Iconic's response to their own ticket anywhere in the UI.
- No priority field exposed (silently defaults to `medium` server-side).

### 2.6 What doesn't exist at all today

- **No "My Services" page.** `milling_service_catalog` (the centre's enabled flows,
  category/subCategory rows, rates, turnaround, monthly capacity) is entirely admin-managed
  and admin-*viewable* (`/api/admin/milling/centers/[id]/service-catalog`, `requireAdmin()`
  only). A centre has no way to see what Iconic has enabled/priced for them without asking.
- **No profile/account page.** A user can't see their own centre's onboarding info (address,
  contract status) or change their own password from the portal.
- **No team page.** Centre users are entirely created/managed by Iconic admin
  (`/api/admin/milling/users`, admin-only) — a `milling_admin` cannot see who else at their
  centre has a login, let alone invite one.
- **No self-performance analytics.** `/api/admin/milling/analytics` computes `avgTatDays`,
  `caseCount`, `activeCaseCount`, `remakeRate` (currently always `null` — no remake tracking
  exists yet) *and* `customerRevenue` per centre — admin-only, and the revenue field must
  never reach the portal (principle 2). Nothing scoped/filtered is exposed to the centre
  itself.
- **No due-date urgency treatment** anywhere (overdue/soon-due highlighting).
- **No search/filter by category** on the cases list, only free-text.

---

## 3. Role capability matrix — current vs proposed

| Capability | `milling_admin` (today) | `milling_production` (today) | `milling_support` (today) | Proposed change |
|---|---|---|---|---|
| View dashboard/cases/case detail | ✅ | ✅ | ✅ (`requireMillingUser()` with no role filter on GETs) | unchanged |
| Design-phase actions (Start Design, upload, Submit for Review) | ✅ | ✅ | ❌ | unchanged — matches `case-flow-update-plan.md` §6.2 |
| Production status update, shipment, manufacturing-file upload | ✅ | ✅ | ❌ | unchanged |
| Raise/view support tickets | ✅ | ✅ | ✅ | unchanged |
| View own service catalog (read-only) | — (doesn't exist) | — | — | **new: all three roles, read-only** |
| View own centre's self-performance stats (TAT, case counts — no revenue) | — | — | — | **new: `milling_admin` only** |
| Edit own centre profile / see contract status | — | — | — | **new: `milling_admin` only, read-only for MVP (see §9)** |
| See colleague list (read-only) | — | — | — | **new: `milling_admin` only** |

---

## 4. Proposed Dashboard (`/milling/dashboard`)

Keep the 5 stat tiles and production summary; add:

1. **Due-soon / overdue strip** — a small list of the centre's own actionable cases
   (design-queue items not yet submitted, production items not yet dispatched) sorted by
   `dueDate`, with overdue ones flagged red. Pulls from the same `/api/milling/cases` data
   already fetched for the list page — just a differently-sorted/filtered slice, requested
   with a `sort=dueDate&limit=5` style param (see §8).
2. **Capacity-at-a-glance** (only if the centre has any `monthlyCapacity` set on a catalog
   row) — "You're at 8/10 Zirconia Crown cases this month" style line(s), read-only,
   non-blocking (matches the existing "no hard capacity gate anywhere" behavior noted in
   `routing-engine.ts` — this is visibility only, never a block).
3. Make "Open case queue" two buttons — **Design Queue** / **Production Queue** — deep-linking
   `/milling/cases?queue=design` / `?queue=production` (the list page already supports the
   query param; the button just needs to pass it through and the list page needs to read the
   initial tab from the URL instead of always defaulting to `production`).

No schema changes needed for #1/#3. #2 needs one new lightweight query (see §8).

---

## 5. Proposed Cases list (`/milling/cases`)

1. **Fix the dead Download button** on the production tab — either wire it to the case's
   `outputFile` (same as the case-detail Files card) or remove it; a button that does nothing
   is worse than no button.
2. **Deep-linkable tab** — read `?queue=` from the URL on load (see Dashboard #3 above) so a
   notification link or dashboard shortcut can land directly on the right tab.
3. **Category filter** alongside the existing free-text search and (production-only) status
   filter — the centre's own catalog categories, sourced from the new My Services data (§7),
   not a hardcoded list.
4. **Due-date urgency styling** — reuse the same red/amber treatment proposed for the
   dashboard strip, applied to the `Due` column.
5. **Row-level "which leg" indicator on the Design Queue tab** — today a Design Queue row's
   status badge already reads e.g. "Design In Progress"; add a small icon distinguishing a
   Flow-3 case (`autoAdvanceToMilling`, will auto-continue to this same centre for production)
   from a Flow-1 case (production undecided or going elsewhere) — purely informational, pulls
   from a field the case-detail endpoint already computes (`isProductionCentre`/committed
   flag) but the *list* endpoint doesn't currently return; needs one field added to the list
   API (§8).

---

## 6. Proposed Case detail (`/milling/cases/[id]`)

1. **Production status Select — remove skip-ahead risk.** Constrain the dropdown to only the
   *next* valid status (or next + terminal-ish "Dispatched"/"Delivered" if already past QC),
   instead of every `millingStatusEnum` value unconditionally. Mirrors how the admin/QC
   internal flow already only shows the next legal action, not a free-choice dropdown.
2. **Add the missing shipment ETA field** to the Shipment card (schema/API already have
   `shipmentEta` — it's just never rendered as an input).
3. **Surface existing support tickets for this case** — a small "Related tickets" list on the
   case detail (subject, status, last update, and Iconic's `adminNotes` once answered),
   instead of the current write-only "Raise flag" card. Requires linking a ticket to a case —
   see §9 for the schema option.
4. **"Design notes" vs "Manufacturing notes" separation** — today `notes` on the assignment
   row is a single field shown once as "Notes from Iconic"; once a case has both a design leg
   and a production leg (Flow 3), the admin's design-hand-off notes and any later
   production-specific notes should be visually distinguishable. Small display-only change
   (no schema change — the design-assign and milling-assign actions already write to the same
   `notes` field; this plan doesn't propose splitting that field, just prefixing/labeling
   entries so they read clearly over time).
5. **Preview files gallery** — `record.previewFiles` is already fetched (added in the last
   round) but the design card only shows an upload button and a count, never the images
   themselves. Add thumbnails so the centre can confirm what's already been uploaded without
   re-opening each file in a new tab.

---

## 7. New: "My Services" page (`/milling/services`)

**Confirmed: view-only, permanently — not just "for MVP."** A centre can see what Iconic has
enabled and priced for them; it has no update, no delete, no add-service action anywhere on
this page. Editing a centre's service catalog (enabling a flow, setting `partnerRate`,
turnaround, monthly capacity, active/inactive) stays exclusively an **admin** action via the
existing `/admin/milling/centers/[id]` editor — this plan does not add any milling-portal
write path to `milling_service_catalog`, now or later.

- Reuses the exact table shape of `MillingServiceCatalogTable.tsx` but as a **read-only
  render** (no `Input`/`Switch`/`Save`/delete icon — just formatted rows), tabbed by flow
  (Design / Design + Milling / Milling Only) exactly like the admin editor, so a centre can
  see: category, restoration, unit type, their own rate, turnaround days, monthly capacity,
  and active/inactive — for every flow they're enabled on.
- New endpoint needed (§8) since the existing one is `requireAdmin()`-gated. This plan
  proposes a **separate, read-only** `milling_portal`-scoped `GET` route rather than loosening
  the admin route's auth — the two routes never share a write path, so there's no code path
  through which a centre could end up editing its own catalog.

---

## 8. API changes summary

| Route | Change | Why |
|---|---|---|
| `GET /api/milling/dashboard` | Add a `dueSoon: MillingCaseRow[]` (top 5 by due date across both queues) and, if any catalog row has `monthlyCapacity` set, a `capacity: {category, subCategory, used, cap}[]` block (current-month count of this centre's cases per catalog line vs its cap). | Powers Dashboard §4 #1/#2. |
| `GET /api/milling/cases` | Read `queue` from the URL on the list page load (frontend-only change, no API change); add `committedToProduction: boolean` per row (derived from `autoAdvanceToMilling` on the assignment) to the design-queue rows. | Powers §5 #2/#5. |
| `GET /api/milling/cases/[id]` | No structural change — already returns everything needed once §6 items are wired to existing fields (`shipmentEta` is already in the row, just unused by the page). | — |
| **New** `GET /api/milling/services` | `requireMillingUser()`, no role restriction — **GET only, no PUT/DELETE handler exists on this route, by design.** Same query shape as the admin route, scoped by `auth.millingCenterId` instead of an `[id]` param, and with **`partnerRate` visible (it's the centre's own rate)** but nothing about client pricing, since this route only ever touches `milling_service_catalog`, a table with no client-price columns at all. | Powers §7 — view-only, confirmed. |
| **New** `GET /api/milling/support/[id]` | `requireMillingUser()`, scoped by centre (same `centerProfileIds` check the list route already uses) — single ticket incl. `adminNotes`. | Powers §6 #3 and a proper Support detail view (§10). |
| `POST /api/milling/support` | Accept an optional `caseId` (see §9) and an optional `priority` (currently hardcoded to `medium` server-side) so a requester can flag urgency themselves — admin can still override it, same as today's status/notes editing. | Powers case-linked tickets, matches how the client-facing support form already lets the requester pick urgency (confirm during implementation whether the client form does this — if not, keep milling consistent with whatever the client flow does rather than diverging). |
| **New** `GET /api/milling/analytics` | `requireMillingUser(['milling_admin'])` — returns *only* `caseCount`, `activeCaseCount`, `avgTatDays`, `remakeRate` (currently always null) for this centre. Deliberately **excludes** `customerRevenue` — this is a new, narrower projection, not the existing admin endpoint reused with a filter, so there is no code path that could accidentally leak revenue to a centre. | Powers a future "My Performance" section — not required for MVP, listed for completeness (§11 marks it optional). |

---

## 9. Data model changes (optional, only for the ticket-linkage feature)

To support §6 #3 ("Related tickets" on a case) and §8's `caseId` on ticket creation:

- Add `relatedCaseId uuid nullable FK → cases.id` to `support_tickets`
  (`src/db/schema/support-ticket.ts`). Nullable so every existing ticket and every non-case
  ticket (billing, account access, etc.) is unaffected.
- **This table is shared** across client, admin, and milling support flows — this plan
  explicitly scopes the change to *adding* a nullable column only; it does not touch the
  client-facing support UI or the admin support UI's existing behavior. The admin ticket list
  could optionally show/link the related case once this exists, but that's a small follow-on,
  not required to ship the milling-portal-facing half.
- Migration would follow the same numbering/idempotent convention as `0054_design_partner_flow.sql`.

If you'd rather not touch a shared table right now, §6 #3 and the `caseId` part of §8 can be
dropped from scope and revisited later — the rest of this plan doesn't depend on it.

---

## 10. Support page improvements (`/milling/support`)

1. **Ticket detail view** — clicking a row opens a panel/dialog showing the full message,
   category, priority, status, and `adminNotes` (Iconic's reply) — today none of this beyond
   the table row is visible.
2. **Priority picker** on ticket creation (see §8).
3. **Case linkage** — if a ticket was raised from a case's "Raise flag" card, show which case
   it's about and deep-link back to it (needs §9's `relatedCaseId`, otherwise skip and keep
   today's free-text-only linkage).
4. This remains a single-message-plus-notes model (no live back-and-forth thread) —
   matching the existing shared `support_tickets` design used by every portal. Turning it into
   a true threaded conversation is a materially bigger change to a shared table/UI used
   by client and admin too, and is **out of scope** for this plan.

---

## 11. Optional / later (not required for this round)

- `GET /api/milling/analytics` + a "My Performance" dashboard section (§8's last row) — nice
  to have, no dependency from anything else in this plan.
- Read-only "My Team" list (`milling_admin` sees colleagues at their centre) — small, additive,
  but touches `profiles` queries scoped by `millingCenterId`; listed here rather than in the
  main plan since it wasn't something you asked for explicitly — flagged as a question in §12.
- Self-service team invite/password reset from the portal — a materially bigger, security-
  sensitive change (creating auth accounts from a non-admin surface); explicitly **not**
  proposed here without your direction.

---

## 12. Edge cases

1. **A centre has zero catalog rows** (shouldn't normally happen post-onboarding, but
   possible mid-setup) — My Services page shows an empty state per flow tab, not an error.
2. **`monthlyCapacity` is null on every row** — the Dashboard's capacity block simply doesn't
   render (already specified as conditional in §4 #2), rather than showing a confusing "0/—".
3. **A ticket's `relatedCaseId` points at a case the centre is no longer assigned to** (e.g.
   reassigned away per `case-flow-update-plan.md` §13.1 #3/#8) — the ticket detail should
   still show the case number for context but the deep-link should 404 gracefully (the
   `/milling/cases/[id]` route already returns "not assigned to your centre" today, which is
   the correct behavior — no change needed there).
4. **Production status dropdown constrained to "next only" (§6 #1)** — must still allow the
   existing behavior of jumping from any earlier production status to `delivered` in one step
   if that's genuinely how some centres operate today; needs a decision (see §13) rather than
   assuming skip-ahead should be blocked outright.
5. **Design Queue "committed to production" indicator (§5 #5)** — must not imply the centre
   can act on production before `ready_for_milling` actually arrives; it's informational only,
   consistent with `isProductionCentre` staying `false` until `millingStatus` is first set
   (`case-flow-update-plan.md` §5.1a's "entered production" signal).

---

## 13. Open questions for you to confirm before implementation

1. **Skip-ahead on production status (§6 #1 / edge case #4):** should the dropdown be
   constrained to the next legal status only, or is jumping straight to `delivered` a real
   workflow some centres need? If real, keep the free dropdown and skip this item.
2. **Ticket ↔ case linkage (§9):** OK to add one nullable `relatedCaseId` column to the shared
   `support_tickets` table, or would you rather keep tickets untouched by this round and drop
   §6 #3 / the `caseId` part of §8 for now?
3. **Priority picker on ticket creation (§8):** should the requester be able to pick
   `low/medium/high/critical` themselves, or should priority stay admin-set only (current
   behavior, defaults to `medium`)?
4. **"My Team" read-only list (§11):** want this in this round, or leave team visibility as
   Iconic-admin-only for now?
5. **`GET /api/milling/analytics` (§8/§11):** worth building now, or defer until there's an
   actual remake-tracking field to make `remakeRate` meaningful (it's `null` everywhere today)?

---

**No code has been changed. This is the plan only — implementation starts after your approval
and answers to §13.**
