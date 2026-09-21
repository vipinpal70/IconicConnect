# Case Flow Update Plan — Milling Centre as Designer

**Status: DRAFT — awaiting approval. No schema, API, or UI code has been changed for this plan.**

This document specifies three additional case-handling flows on top of the case system that
exists today on `phase2`. It is written from the actual current schema and code (files cited
throughout), not from the older aspirational plans (`milling-implementation-plan.md`,
`milling-center-admin-level-plan.md`) — those are cross-referenced where still accurate and
flagged where this plan supersedes them.

---

## 1. What's being added, in one paragraph

Today a **Milling Centre** only ever touches a case after Iconic's own team has finished the
design and QC has approved it — it exists purely to *manufacture*. This plan lets a Milling
Centre also act as the **designer**: Iconic can hand the "In Design" step itself to a
Design+Milling-enabled centre, exactly the way it hands that step to an internal designer
today. The centre does the CAD work in their own portal, uploads output + preview files,
hits "Submit for Review," and the case lands back in Internal QC — indistinguishable, from
that point on, from a case an internal designer produced. Whether that same centre *also*
mills the case, or a different centre is picked later, or no milling happens at all, is a
second, independent decision. Three named flows fall out of combining these two decisions;
they are documented in full in §7.

---

## 2. Actors & portals (glossary)

| Term used below | Who / what it is | Portal |
|---|---|---|
| **Lab / Client / Dental Lab** | `userType='lab_portal'`, `role='client'` or `'subuser'`. Submits cases, receives results. | Client portal (`src/app/client/**`) |
| **Admin** | `userType='admin_portal'`, `role='admin'`. Full control. | Admin portal (`src/app/admin/**`) |
| **QC** | `role='qc'`. Reviews design output, gatekeeps Internal QC → next stage. | Admin portal |
| **Designer** | `role='designer'`. Does in-house CAD design. | Admin portal |
| **Milling Centre / Partner / Centre** | A row in `milling_centers`. An external company. | Milling portal (`src/app/milling/**`) |
| **Milling Centre user** | `userType='milling_portal'`, `role` ∈ `milling_admin`/`milling_production`/`milling_support`, scoped by `profiles.milling_center_id`. | Milling portal |
| **"Labs" (as the user wrote it)** | = the Client portal above. Used interchangeably below. | — |

---

## 3. Current system — grounded recap (nothing here is proposed, all of it exists today)

### 3.1 Three case-level service flows already exist

`cases.serviceType` (`src/db/schema/case.ts:40`) is one of:

- **`design_only`** — Iconic designs, delivers digital files, client approves.
- **`design_milling`** — Iconic designs, QC approves, a Milling Centre manufactures and ships
  the physical product to the lab's address. **No client-approval step** in this flow today.
- **`milling_only`** — client sends mill-ready files directly; no design phase at all.

Each has its own status → label → lifecycle-step mapping, fully encoded in
`src/lib/case-status-mapping.ts` (`STATUS_MAPPING`). This module — not `case.ts`'s older
`CLIENT_STATUS_LABELS`/`INTERNAL_STATUS_LABELS` maps — is the **flow-aware source of truth**
and is what `StatusBadge`, `CaseDetailView`, and `notifyCaseStatusChanged` all read from.

### 3.2 The one status enum, shared by every flow

`caseStatusEnum` (`src/db/schema/case.ts:17`):

```
scan_received → scan_verified / scan_not_verified → allocated_to_designer → in_progress
→ internal_qc → submitted_to_client → approved → [ready_for_milling → milling_in_progress
→ milling_qc → dispatched] → delivered
                       ⤷ on_hold / cancelled / client_feedback / change_requested / client_reject
                          (exception branches, re-enter the happy path)
```

A single `cases.status` column drives every portal. `case-status-mapping.ts` decides which
subset of these values is "in play" for a given `serviceType`, and what each is called.

### 3.3 Who is allowed to move a case, today

Two layers, both already in code:

1. **`canTransitionCaseStatus`** (`src/lib/case-status-transitions.ts`) — coarse, flow-aware
   gate: is `targetStatus` even part of this `serviceType`'s flow; clients can never set a
   milling-production status; a `design_milling` case can't skip Internal QC to reach
   production; a `milling_*` role can only ever set production statuses.
2. **Per-role branches inline in `PUT /api/cases/[id]`** (`src/app/api/cases/[id]/route.ts`,
   ~line 204 onward) — the actual fine-grained rules: a `designer` can only touch a case where
   `caseRecord.designerId === profile.id`; a `qc` can only push `internal_qc → submitted_to_client`
   if `caseRecord.qcId === profile.id`; sending to QC requires an `outputFile` and an assigned
   `qcId`; etc.

Milling-portal role checks live in a **separate, smaller route**:
`PATCH /api/milling/cases/[id]/status` (`src/app/api/milling/cases/[id]/status/route.ts`),
gated by `requireMillingUser(['milling_admin','milling_production'])`
(`src/lib/milling/portal-guard.ts`). It only accepts values from `millingStatusEnum`
(`ready_for_milling | milling_in_progress | milling_qc | dispatched | delivered`) and only
for the assignment row belonging to that user's own centre. **It has no concept of design
statuses (`allocated_to_designer`, `in_progress`, `internal_qc`) at all today.**

### 3.4 The milling-centre-as-manufacturer model

- `milling_centers` (`src/db/schema/milling.ts:30`) — one row per partner. Already has
  **`enabledServiceTypes: text[]`** — which of the *same three* flow strings
  (`design_only` / `design_milling` / `milling_only`) that centre is allowed to work on — and
  a per-flow **`milling_service_catalog`** (category, subCategory, unitType, partnerRate,
  turnaround, `isActive`), unique on `(centerId, serviceType, category, subCategory)`.
- The admin-only onboarding UI (`src/app/admin/(dashboard)/milling/centers/[id]/page.tsx`)
  already renders **three tabs — "Design", "Design + Milling", "Milling Only"** — for exactly
  these three catalogs (`FLOWS` constant, line 26). **The "Design" and "Design + Milling"
  catalog tabs already exist and can already hold priced rows — nothing in the case flow
  reads them for design work today.** This is the exact gap this plan closes: the data model
  for "this centre can also design" is already half-built and simply never wired up.
- **`milling_case_assignments`** (`src/db/schema/milling.ts:120`) — **one row per case**
  (`caseId` is `unique()`), created by `POST /api/cases/[id]/milling-assign`
  (`src/app/api/cases/[id]/milling-assign/route.ts`) only once a case reaches `internal_qc`
  (`design_milling`) or `scan_verified` (`milling_only`) — i.e. only for the **production**
  step, never for design.
- **Known gap, not part of this plan's new flows but relevant to "always check what service is
  enabled":** `AssignMillingCenterDialog.tsx` (the actual UI admin/QC/designer use to pick a
  centre for production) currently lists **every active centre**, with no filter on
  `enabledServiceTypes` or on a matching active `milling_service_catalog` row for the case's
  own category/subCategory/serviceType. `routeCase()` (`src/lib/milling/routing-engine.ts`)
  *does* filter by routing-rule scope, but the manual "or pick a different centre" list next to
  it does not. §9 below specifies the fix as part of this update, since the new design-assignment
  picker needs the same eligibility filter and it would be inconsistent to add it only there.

### 3.5 Client-privacy rule (must not regress)

`design_milling`'s client-facing labels never mention milling or a centre name —
`ready_for_milling`/`milling_in_progress`/`milling_qc` all read as **"In Production"** to the
client, `dispatched` as **"Shipped"** (`case-status-mapping.ts`, `designMilling.statuses`).
`CaseTimelineEvent` (`case.ts:132`) even carries a `clientLabel` / `clientHidden` override pair
specifically so milling-centre timeline entries can be rewritten or hidden before a client ever
sees them. **This plan does not change that rule.** A case designed by a partner centre must
look, to the client, identical to one designed in-house — same statuses, same labels, same
"Fulfilled by Iconic" framing. The *only* audience allowed to know a centre did the design is
Admin/QC.

---

## 4. The core idea: two independent decisions, not three separate flows

Rather than bolting on three parallel, hand-built flows, this plan adds exactly **two new
decision points**, both made once — at case-assignment time. The three flows the user asked
for fall out of the combination:

**Decision A — Who designs this case?**
- `internal` (today's only option) — an admin/QC allocates a `designer` profile, exactly as now.
- `partner` (new) — an admin/QC allocates a **Design-capable Milling Centre** instead. The centre
  does the design work in the milling portal; everything downstream (QC, approval, billing) is
  unchanged.

**Decision B — Once design is approved, who mills it (if the flow needs milling at all)?**
- N/A — `design_only` case: no milling step exists.
- `deferred` (today's only option for `design_milling`) — admin explicitly runs
  "Assign to Milling Centre" *after* Internal QC/approval, picking any eligible centre
  (possibly the same one that designed it, possibly not).
- `same_as_design` (new) — decided **up front**, at the moment the case is handed to a partner
  centre for design: "this centre also mills it — don't ask me again." The moment QC approves,
  the case auto-advances into production under that same centre, with no second assignment click.

| User's flow # | Decision A | Decision B | `serviceType` it applies to |
|---|---|---|---|
| **Flow 2** (confirm existing — already built) | `internal` | `deferred` | `design_milling` |
| **Flow 1** (new) | `partner` | `deferred` (or N/A if `design_only`) | `design_only` **or** `design_milling` |
| **Flow 3** (new) | `partner` | `same_as_design` | `design_milling` only (a design_only case has nothing to auto-advance into) |

This framing is why the plan below introduces one new assignment concept, not three
independent state machines — see §5.

---

## 5. Data model changes (conceptual — no migration written yet)

### 5.1 `milling_case_assignments` — extend, don't replace

Two problems with the current shape (`src/db/schema/milling.ts:120`) block Decision A/B:

1. It only has one `millingCenterId` column. If a case is designed by Centre A (Flow 1) and
   later milled by a *different* Centre B, updating the same unique-per-case row would silently
   overwrite "Centre A designed this" the moment Centre B is assigned for production — losing
   which centre actually did the design. `cases.timeline` (a jsonb log) would still show it
   happened, but nothing joinable/queryable would.
2. `millingStatus` is a `NOT NULL` enum of **production-only** values
   (`ready_for_milling|milling_in_progress|milling_qc|dispatched|delivered`). There is no value
   in it that means "designing" — and there shouldn't be one added, because `cases.status`
   already has `allocated_to_designer`/`in_progress`/`internal_qc` for exactly that, and every
   other part of the system (notifications, QC queue, `case-status-mapping.ts`) already keys off
   `cases.status`. Duplicating that state into a second enum would be the thing to avoid.

**Proposed change:**

| Column | Change | Why |
|---|---|---|
| `millingCenterId` | **Split into two nullable FKs**: `designCenterId uuid` and `productionCenterId uuid` (both → `milling_centers.id`) | Preserves "who designed it" independently of "who's milling it," even after a reassignment. Either can be null; both set = the same-centre case (Flow 3, or Flow 1 later converging on the same centre by coincidence). |
| `millingStatus` | Make **nullable**. Stays meaningful only once `productionCenterId` is set; `null` while a case is purely in the design stage. | Avoids inventing fake production values for a design-only assignment. |
| *(new)* `scope` | `pgEnum`: `'design' \| 'milling' \| 'design_milling'` | Denormalized convenience flag kept in sync with which of the two center-id columns are populated — drives filtering/badges without re-deriving it every render. |
| *(new)* `autoAdvanceToMilling` | `boolean default false` | Set `true` only when the admin explicitly picks Flow 3 at assignment time. Read once, at the moment the case would otherwise sit in `approved`/`internal_qc`-cleared limbo, to decide whether to silently create the production leg using `designCenterId` as `productionCenterId`, or wait for a manual "Assign to Milling Centre" action. |
| `assignedAt` | **Split into** `designAssignedAt` / `productionAssignedAt` (both nullable timestamps) | So each stage's own SLA/turnaround clock can be measured (see §11.3 analytics note). |
| everything else (`carrier`, `trackingNumber`, `shipmentEta`, `notes`, `shipToName`, `shipToAddress`) | unchanged | Still only meaningful for the production leg. |

The table keeps its `unique(caseId)` constraint — still one row per case; it always reflects
**current** state only (who's designing/milling it *right now*).

### 5.1a `case_center_assignment_history` — new, append-only (confirmed in scope — see §16)

Every assignment, reassignment, or withdrawal of a centre from either leg of a case is also
recorded as an immutable row here, so "Centre B was tried and went inactive, Centre C took
over" is queryable and joinable, not just readable prose buried in `cases.timeline`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `caseId` | uuid FK → `cases.id` | |
| `role` | `pgEnum('design' \| 'milling')` | which leg of the case this event is about |
| `action` | `pgEnum('assigned' \| 'reassigned' \| 'withdrawn' \| 'auto_advanced')` | `auto_advanced` = the Flow 3 system-triggered hand-off (§7.3), distinguished from a manual admin/QC action |
| `millingCenterId` | uuid FK → `milling_centers.id`, nullable | the centre *after* this event; null = withdrawn back to unassigned/internal |
| `previousCenterId` | uuid FK, nullable | the centre *before* this event, if any — makes "from X to Y" a single row instead of two |
| `actorId` | uuid FK → `profiles.id`, nullable | who performed it; null for `auto_advanced` (system-triggered) |
| `reason` | text, nullable | free-text, e.g. "centre went inactive," "overloaded this month" |
| `createdAt` | timestamp | |

`milling_case_assignments` stays the fast "current state" lookup every existing query
(portal scoping, admin case list) already relies on; this new table is purely additive —
nothing that reads `milling_case_assignments` today needs to change. Every write to
`designCenterId`/`productionCenterId` on the current-state row gets a matching insert here in
the same transaction.

### 5.2 `cases` table — one new optional denormalized column

| Column | Change | Why |
|---|---|---|
| *(new)* `designSource` | `varchar`, `'internal' \| 'partner'`, default `'internal'` | Mirrors why `serviceType` already lives directly on `cases` instead of being derived — the admin case list needs to filter/badge/sort on "who's designing this" without a join on every row. Kept in sync whenever `milling_case_assignments.designCenterId` is set/cleared. **Not** a new source of truth — `designCenterId` on the assignment row is authoritative; this column is a read-optimization, same role `serviceType` already plays. |

`cases.designerId` is **left exactly as-is** and is simply **`null` whenever `designSource =
'partner'`**. This is the least invasive choice available: `designerId` is read in a lot of
places (self-allocation checks, notification targets, `hasAllRequiredCaseFields`-adjacent
logic, the admin case list's "assigned to me" filter) and none of them need to learn about
centres if a null `designerId` simply means "not an internal designer, check the assignment
row instead" wherever "who's designing this" needs to be displayed.

### 5.3 No changes needed to `milling_service_catalog` / `enabledServiceTypes`

As noted in §3.4, the **"Design" and "Design + Milling" catalog tabs already exist** per
centre. This plan is purely about *reading* them at case-assignment time — see §9.

---

## 6. Roles & permissions changes

### 6.1 Admin / QC — new action alongside "Allocate Designer"

Wherever a case can currently be allocated to an internal designer (`AllocateMenu` in
`src/app/admin/(dashboard)/cases/page.tsx`, and the equivalent control in
`CaseDetailView.tsx`/`cases/[id]/page.tsx`), a **second option** appears once the case is at
`scan_verified` (or being re-allocated from `on_hold`/`client_feedback`/`client_reject`):

> **Assign to Design Partner** → opens a centre picker (same shape as
> `AssignMillingCenterDialog`, filtered per §9) → admin picks a centre → for a
> `design_milling` case, a checkbox: **"This centre will also mill the case"** (sets
> `autoAdvanceToMilling`). For a `design_only` case this checkbox is not shown (nothing to
> auto-advance into).

Only `admin` and `qc` may take this action — same as who can allocate an internal designer
today (`designer` self-allocation has no partner-centre equivalent; a centre never "picks up"
unassigned work the way an internal designer can self-allocate at `scan_received`/`scan_verified`
in `route.ts:390-399` — a partner centre only ever receives a case that Iconic explicitly hands
it, mirroring the existing production-assignment model exactly).

**QC lead must be pre-assigned at hand-off time.** A partner centre has no visibility into
Iconic's internal staff and cannot pick a QC lead the way `route.ts`'s designer/QC branches
allow each other to do. The "Assign to Design Partner" dialog therefore **requires a `qcId`
to already be set (or be set in the same action)** — this is a stricter version of the existing
"cannot send to QC without assigning a QC Lead first" rule (`route.ts:338`), moved earlier so
it's enforced at hand-off instead of at submit-for-review time, since the centre has no way to
satisfy it themselves. **Confirmed (§16): this is a hard requirement, no round-robin/default
QC fallback** — the assignment action simply cannot complete without a `qcId`.

### 6.2 Milling portal — new design-phase actions

`requireMillingUser(['milling_admin','milling_production'])` gains the ability to act on a case
when `milling_case_assignments.designCenterId === auth.millingCenterId` (parallel to how the
`designer` branch in `route.ts` checks `caseRecord.designerId === profile.id`):

| From status | Action | To status | Guard |
|---|---|---|---|
| `allocated_to_designer` | Start Design | `in_progress` | assignment's `designCenterId` matches |
| `in_progress` | Upload output/preview file | *(no status change)* | same as today's designer `outputFile`/`previewFile` PUT |
| `in_progress` | Submit for Review | `internal_qc` | requires an `outputFile` present (identical rule to `route.ts:441-444`) and `qcId` already set (per §6.1, always true by construction for a partner-designed case) |
| `internal_qc` | *(read-only)* | — | centre cannot self-advance out of QC — only QC/admin can, same as internal designers today |
| `in_progress` (after a QC reject) | Re-upload + Submit for Review | `internal_qc` | same as the initial submit — the rejected case returns to **the same centre**, never to a different one automatically |

**Explicitly NOT granted to the milling portal:** setting `on_hold`, `cancelled`,
`submitted_to_client`, `approved`, or any client-facing status. A partner centre that hits a
problem uses the existing **support-ticket mechanism** (`/api/milling/support`,
`src/app/milling/(dashboard)/support/page.tsx`) to flag it to Iconic rather than self-holding the
case — kept consistent with "Milling Centre CAN raise flags / support tickets" already scoped in
`milling-implementation-plan.md` §"What a Milling Centre Can Do."

### 6.3 What does *not* change

- Client/subuser permissions: unchanged. A client never sees, selects, or is asked about a
  design partner. `canTransitionCaseStatus`'s existing "clients can't set milling production
  statuses" rule needs no change — it already blocks this by role, not by status subset.
- `account_manager`/`consultant`: unchanged (read-only / uninvolved).
- Billing: unchanged mechanism, see §12.

---

## 7. The three flows, in full

### 7.0 Notation used in the tables below

- **DB** = `cases.status` value (ground truth, same column every portal reads).
- **Client** = label the Lab portal shows (`case-status-mapping.ts`, `viewer: 'client'`).
- **Admin/QC** = label the Admin portal shows (`viewer: 'admin'`), **plus** a bracketed
  `[Partner: Centre Name]` suffix this plan adds whenever `designSource = 'partner'` (or,
  once past design, whenever `productionCenterId` is set) — purely a display affordance, not a
  new status.
- **Milling Portal** = what the *assigned* centre sees (new column; blank = centre has no
  visibility into this state, either because it's not yet assigned or the case has moved past
  what that centre is responsible for).

---

### 7.1 Flow 2 — In-house design, partner milling *(already built — documented for completeness)*

**Decision A = internal, Decision B = deferred.** `serviceType = design_milling`.

This is exactly today's system. No new work items in this plan touch it, other than the
optional admin-label `[Partner: …]` suffix now also applying at the production stage (it
already conceptually applies there, just wasn't labeled that way in the UI).

```
Lab submits (Design+Milling)
   → scan_received
Admin/QC verifies scan
   → scan_verified
Admin/QC allocates an INTERNAL designer
   → allocated_to_designer
Designer starts work
   → in_progress
Designer uploads output+preview, sends to QC
   → internal_qc
QC approves (no client step in this flow)
   → internal_qc  (QC action: "Approve" → triggers milling hand-off)
Admin/QC assigns a Milling Centre (any eligible centre — see §9)
   → ready_for_milling                      [productionCenterId set]
Milling Centre: mill → QC → ship
   → milling_in_progress → milling_qc → dispatched
Lab receives physical product
   → delivered
```

| DB | Client | Admin/QC | Milling Portal |
|---|---|---|---|
| `scan_received` | Case Submitted | Scan Received | — |
| `scan_verified` | Validated | Scan Verified | — |
| `allocated_to_designer` | In Design | Allocated to Designer | — |
| `in_progress` | In Design | In Progress | — |
| `internal_qc` | Internal QC | Internal QC | — |
| `ready_for_milling` | In Production | Ready for Milling | Ready for Milling |
| `milling_in_progress` | In Production | Milling in Progress | Milling in Progress |
| `milling_qc` | In Production | Milling QC | Milling QC |
| `dispatched` | Dispatched | Dispatched | Dispatched |
| `delivered` | Delivered | Delivered | Delivered |

---

### 7.2 Flow 1 — Design outsourced to a partner centre, milling decided later (or not at all)

**Decision A = partner, Decision B = deferred / N/A.** `serviceType = design_only` **or**
`design_milling`.

```
Lab submits case
   → scan_received
Admin/QC verifies scan
   → scan_verified
Admin/QC picks "Assign to Design Partner" → selects an eligible centre (§9) → pre-assigns a QC lead
   → allocated_to_designer            [designCenterId set, designSource='partner']
Centre logs into the MILLING PORTAL, sees the case appear (design queue)
Centre clicks "Start Design"
   → in_progress
Centre uploads output + preview files, clicks "Submit for Review"
   → internal_qc                       ← rejoins the ordinary main flow here
QC reviews exactly like an internally-designed case:
  · Reject  → in_progress   (returns to the SAME centre, not an internal designer)
  · Approve →
      if design_only:  → submitted_to_client → approved → delivered  (digital, client approves)
      if design_milling: → Admin/QC now separately runs "Assign to Milling Centre" —
                            may pick the SAME centre that designed it, or a different one, or
                            (rare) decide the case needs no milling after all and closes it out
                            manually → ready_for_milling → … → delivered
```

| DB | Client | Admin/QC | Milling Portal |
|---|---|---|---|
| `scan_received` | Case Submitted | Scan Received | — |
| `scan_verified` | Validated | Scan Verified | — |
| `allocated_to_designer` | In Design | Allocated to Designer `[Partner: Acme Mill Co.]` | **New Design Assignment** |
| `in_progress` | In Design | In Progress `[Partner: Acme Mill Co.]` | **Design In Progress** |
| `internal_qc` | Internal QC | Internal QC `[Partner: Acme Mill Co.]` | **Submitted — Awaiting QC** *(read-only)* |
| `in_progress` (post-reject) | In Design | In Progress `[Partner: Acme Mill Co.]` | **Revision Requested** |
| — *(design_only branch)* — | | | |
| `submitted_to_client` | Client Review | Submitted to Client | — *(centre's job is done)* |
| `approved` | Case Approved | Approved | — |
| `delivered` | Completed | Delivered | — |
| — *(design_milling branch)* — | | | |
| `ready_for_milling` | In Production | Ready for Milling `[Partner: <production centre>]` | Ready for Milling *(only if this centre also got the milling job)* |
| `milling_in_progress`…`dispatched` | In Production / Dispatched | (unchanged from 7.1) | (unchanged from 7.1) |
| `delivered` | Delivered | Delivered | Delivered |

**Note on the `design_only` sub-case:** once QC approves, the case leaves the centre's world
entirely — it becomes indistinguishable from a normal in-house `design_only` case for the
client-approval step. The centre never sees `submitted_to_client`/`approved`; their portal
visibility for this case ends at `internal_qc`.

---

### 7.3 Flow 3 — Single centre does design **and** milling, committed up front

**Decision A = partner, Decision B = same_as_design.** `serviceType = design_milling` only.

Identical to Flow 1's `design_milling` branch through Internal QC, with one difference: the
admin ticks **"This centre will also mill the case"** at assignment time
(`autoAdvanceToMilling = true`, `designCenterId = productionCenterId = <centre>`,
`scope = 'design_milling'`). The moment QC approves, the system auto-creates the production leg
against the *same* row — **no second "Assign to Milling Centre" click required.**

```
Lab submits case (Design + Milling)
   → scan_received
Admin/QC verifies scan
   → scan_verified
Admin/QC picks "Assign to Design Partner", selects a centre, ticks
"This centre will also mill the case"
   → allocated_to_designer   [designCenterId = productionCenterId = Centre X,
                              autoAdvanceToMilling = true]
Centre designs (same as Flow 1)
   → in_progress → internal_qc
QC approves
   → SYSTEM auto-transitions (no manual milling-assign step):
   → ready_for_milling        [same assignment row, productionCenterId already = Centre X]
Same centre: mill → QC → ship (same portal session, same case, no re-login/re-pickup)
   → milling_in_progress → milling_qc → dispatched
Lab receives physical product
   → delivered
```

| DB | Client | Admin/QC | Milling Portal |
|---|---|---|---|
| `scan_received` | Case Submitted | Scan Received | — |
| `scan_verified` | Validated | Scan Verified | — |
| `allocated_to_designer` | In Design | Allocated to Designer `[Partner: Acme Mill Co. — Design+Mill]` | New Design Assignment |
| `in_progress` | In Design | In Progress `[Partner: Acme Mill Co. — Design+Mill]` | Design In Progress |
| `internal_qc` | Internal QC | Internal QC `[Partner: Acme Mill Co. — Design+Mill]` | Submitted — Awaiting QC |
| `ready_for_milling` | In Production | Ready for Milling *(auto — no admin click)* | Ready for Milling |
| `milling_in_progress` | In Production | Milling in Progress | Milling in Progress |
| `milling_qc` | In Production | Milling QC | Milling QC |
| `dispatched` | Dispatched | Dispatched | Dispatched |
| `delivered` | Delivered | Delivered | Delivered |

If QC **rejects** at `internal_qc`, the case returns to `in_progress` with the *same* centre —
`autoAdvanceToMilling` stays `true`, so once re-approved it still auto-advances. Admin can
still manually break this commitment later (see edge case §13.4) if e.g. the centre goes
inactive between design approval and the production hand-off.

---

## 8. Master flow diagram (all paths, one picture)

```
                              ┌───────────────────────┐
                              │  Lab submits a case    │
                              └───────────┬────────────┘
                                          ▼
                              scan_received ──(reject)──► scan_not_verified ──┐
                                          │                                    │
                                     (verify)                            (fix & resubmit)
                                          ▼                                    │
                                  scan_verified ◄───────────────────────────────┘
                                          │
                     ┌────────────────────┼─────────────────────────┐
                     ▼                    ▼                          ▼
        serviceType = milling_only   [DECISION A: who designs?]      │
                     │              internal          partner        │
                     │                 │                 │           │
                     │       allocate designer   assign design    (same node,
                     │        (existing)         partner (NEW —     just the
                     │                             §6.1, §9)        two design-
                     │                 │                 │          source
                     │                 └────────┬────────┘         branches
                     │                          ▼                  converge)
                     │              allocated_to_designer
                     │            [designSource: internal|partner]
                     │                          │
                     │                  (designer/centre
                     │                   starts work)
                     │                          ▼
                     │                     in_progress
                     │                          │
                     │            (upload output+preview, submit)
                     │                          ▼
                     │                    internal_qc ◄──────────────┐
                     │                     /        \                │
                     │                (reject)    (approve)     back to
                     │                   │            │          in_progress
                     │                   └────────────┘       (same designer
                     │                                         OR same centre —
                     │                                          never swapped)
                     │                          │
                     │        ┌─────────────────┴─────────────────┐
                     │        ▼                                    ▼
                     │  serviceType = design_only          serviceType = design_milling
                     │        │                                    │
                     │  submitted_to_client                [DECISION B: who mills?]
                     │   /      |        \                  deferred | same_as_design
                     │ approve  feedback  reject                 │         │
                     │   │        │         │            (admin picks a   (auto — the
                     │   ▼        ▼         ▼             centre now,      SAME centre
                     │ approved  in_prog  client_reject    any eligible    from design,
                     │   │      (loop)      (terminal)     centre — §9)   no admin click)
                     │   ▼                                      │         │
                     │ delivered                                └────┬────┘
                     │                                                ▼
                     └──────────────────────────────────►    ready_for_milling
                    (milling_only skips design entirely,               │
                     enters here straight from scan_verified)   milling_in_progress
                                                                        │
                                                                   milling_qc
                                                                        │
                                                                    dispatched
                                                                        │
                                                                    delivered

   Exception branches available from almost any non-terminal node (role-gated):
   on_hold  ·  cancelled  ·  change_requested  (design_only client-review loop only)
```

---

## 9. Eligibility logic — "always check what's enabled" (§ the user's explicit requirement)

Both the new design-assignment picker (§6.1) and the *existing* production picker
(`AssignMillingCenterDialog`, which today does **not** filter — see §3.4) must apply the same
two-part check before a centre appears as selectable:

**A centre C is eligible to be assigned role `R` (`design` or `milling`) on case `X` iff:**

1. `C.active === true`
2. `X.serviceType ∈ C.enabledServiceTypes`
   - For `R = design` on a `design_only` case → checks the centre's **"Design"** tab enablement.
   - For `R = design` on a `design_milling` case (Flow 1 or Flow 3) → checks the centre's
     **"Design + Milling"** tab enablement — *not* a separate "design-only-within-a-
     design_milling-case" tab. There is deliberately no fourth catalog bucket: a centre that
     can design a `design_milling` case is, by definition, a "Design + Milling" centre in the
     catalog sense, whether or not it ends up also milling *this particular* case.
   - For `R = milling` on `design_milling` or `milling_only` → checks **"Design + Milling"** /
     **"Milling Only"** respectively (unchanged from what *should* already be happening).
3. An **active** `milling_service_catalog` row exists for
   `(centerId = C.id, serviceType = X.serviceType, category = X.category, subCategory =
   resolveCaseSubCategory(X.category, X.subTypeData))` — i.e. the centre has actually priced
   *this* restoration under *this* flow, not just switched the flow on in general. Reuses
   `resolveCaseSubCategory` (`src/lib/pricing.ts`), already used identically by the routing
   engine (§ `milling-assign/route.ts:88`).

Centres failing any check are simply absent from the picker (not shown disabled) — consistent
with how the client-facing service catalog already hides, rather than disables, unavailable
options (`case-architecture-plan.md` §7.2).

`routeCase()` (`src/lib/milling/routing-engine.ts`) can optionally be extended to also
recommend a *design* centre the same way it recommends a *milling* centre (same routing-rule
scope shape — `products`/`restorations`/`states` already generalize to either role); this is a
nice-to-have, not required to ship the three flows, and is listed as optional in §15.

**Fixing the existing gap:** as part of this update, `AssignMillingCenterDialog`'s "or pick a
different centre" list must start applying check 2+3 above — today it lists every active
centre regardless of what they've enabled or priced. Left as-is, it would be inconsistent (and
confusing to admins) for the *new* design picker to filter correctly while the *existing*
production picker still doesn't.

---

## 10. Status mapping — full matrix across all three portals

Statuses not reachable in a given flow are blank. `[P]` marks a label that gets the
`[Partner: Centre Name]` admin-only suffix from §7.0 when `designSource='partner'` or a
production centre is assigned.

| DB status | Client (Lab) label | Admin/QC label | Milling Portal label | Reachable in |
|---|---|---|---|---|
| `scan_received` | Case Submitted | Scan Received | — | all |
| `scan_not_verified` | In Validation | Scan Rejected | — | all except `milling_only`'s client wording ("File Needs Review") |
| `scan_verified` | Validated | Scan Verified | — | all |
| `allocated_to_designer` | In Design | Allocated to Designer `[P]` | New Design Assignment *(only if `designCenterId` = own centre)* | `design_only`, `design_milling` |
| `in_progress` | In Design | In Progress `[P]` | Design In Progress / Revision Requested | `design_only`, `design_milling` |
| `internal_qc` | Internal QC | Internal QC `[P]` | Submitted — Awaiting QC *(read-only)* | `design_only`, `design_milling` |
| `submitted_to_client` | Client Review | Submitted to Client | — | `design_only` (rare manual use in `design_milling`) |
| `change_requested` | Change Requested | Change Requested | — | `design_only` |
| `client_feedback` | Feedback | Client Feedback | Revision Requested *(if partner-designed)* | `design_only`, `design_milling` |
| `approved` | Case Approved | Approved | — | `design_only`; also a transient value in `design_milling` |
| `ready_for_milling` | In Production | Ready for Milling `[P]` | Ready for Milling *(if `productionCenterId` = own centre)* | `design_milling`, `milling_only` |
| `milling_in_progress` | In Production | Milling in Progress | Milling in Progress | `design_milling`, `milling_only` |
| `milling_qc` | In Production | Milling QC | Milling QC | `design_milling`, `milling_only` |
| `dispatched` | Dispatched / Shipped | Dispatched | Dispatched | `design_milling`, `milling_only` |
| `delivered` | Completed / Delivered | Delivered | Delivered | all |
| `on_hold` | On Hold | On Hold | Case On Hold *(read-only banner)* | all |
| `cancelled` | Cancelled | Cancelled | Case Cancelled *(read-only)* | all |
| `client_reject` | Rejected | Rejected | *(not visible — centre's stage is over)* | `design_only` mainly |

**Rule that must hold everywhere:** the **Client** column of this table is 100% unchanged by
this plan. Every new behavior is additive to the **Admin/QC** and **Milling Portal** columns
only.

---

## 11. Example end-to-end walkthroughs

### 11.1 Flow 1 example — `CAB-0512`, Crown & Bridge, `design_only`, designed by a partner

1. Client `Bright Smiles Lab` submits `CAB-0512` (Crown, tooth #14) as **Design Only**.
   → `scan_received`.
2. Admin verifies the scan. → `scan_verified`.
3. Admin opens the case, clicks **Assign to Design Partner**. The picker (filtered per §9)
   shows only centres with `design_only` enabled *and* an active `(Crown & Bridge, Crown,
   design_only)` catalog row — say, `Acme Mill Co.` and `Precision Dental Labs`. Admin picks
   `Acme Mill Co.`, and assigns QC lead `Priya` in the same dialog.
   → `allocated_to_designer`, `designCenterId = Acme`, `qcId = Priya`.
4. `Acme Mill Co.`'s `milling_admin` logs into the milling portal, sees `CAB-0512` under
   **Design Queue**, opens it, sees the input scan (`case_files`, tooth #14, notes), clicks
   **Start Design**. → `in_progress`.
5. Acme's designer works in their own CAD software, comes back to the portal, uploads
   `CAB-0512_design.stl` as the output file and a `.png` preview, clicks **Submit for Review**.
   → `internal_qc`. Acme's portal view for this case now shows "Submitted — Awaiting QC" and is
   read-only.
6. `Priya` (QC) reviews in the Admin portal exactly as she would an internal designer's case —
   sees the `[Partner: Acme Mill Co.]` tag so she knows to route any needed changes back to
   Acme rather than to an internal designer, but the review UI is otherwise identical. She
   finds an occlusion issue and clicks **Reject**. → `in_progress`, still `designCenterId =
   Acme`. Acme gets notified, fixes it, re-submits. → `internal_qc` again.
7. Priya approves. → `submitted_to_client`.
8. Bright Smiles Lab reviews the digital design in the client portal (label: "Client Review"),
   clicks **Approve**. → `approved` → `delivered` (digital file handed off). Acme never sees
   these last two steps — their portal visibility for `CAB-0512` ended at step 6.

### 11.2 Flow 3 example — `CDM-0091`, Denture, `design_milling`, one centre end-to-end

1. `Sunrise Dental` submits `CDM-0091` (Full Denture, Both Arches) as **Design + Milling**.
   → `scan_received` → (verified) → `scan_verified`.
2. Admin clicks **Assign to Design Partner**, picker filtered to centres with `design_milling`
   enabled and an active `(Dentures, Full Denture, design_milling)` catalog row — picks
   `Precision Dental Labs`, **ticks "This centre will also mill the case,"** assigns QC lead
   `Marcus`.
   → `allocated_to_designer`, `designCenterId = productionCenterId = Precision`,
   `autoAdvanceToMilling = true`, `scope = design_milling`.
3. Precision starts design (`in_progress`), uploads output, submits (`internal_qc`).
4. Marcus approves. **No second assignment action happens** — the system sees
   `autoAdvanceToMilling = true` on the existing row and immediately sets
   → `ready_for_milling`. Precision's portal, already logged in from the design step, now shows
   this same case under **Ready for Milling** instead of a fresh "assigned case" notification.
5. Precision manufactures, runs their own milling QC, packages, ships. →
   `milling_in_progress` → `milling_qc` → `dispatched` (Precision enters carrier + tracking).
6. Physical denture arrives at Sunrise Dental's address. → `delivered`. Sunrise's client portal
   only ever showed "In Design" → "Internal QC" → "In Production" → "Dispatched" →
   "Delivered" — no mention of Precision Dental Labs anywhere.

### 11.3 Flow 2 example (for contrast — unchanged system) — `CAI-0208`, Implants, `design_milling`, in-house design

1. `Metro Dental` submits `CAI-0208` (Ti-Base, Crown) as **Design + Milling**. → `scan_received`
   → `scan_verified`.
2. Admin allocates internal designer `Wei`. → `allocated_to_designer` → (Wei starts) →
   `in_progress` → (uploads, sends to QC, `qcId = Marcus`) → `internal_qc`.
3. Marcus approves. → *(no auto-advance — `autoAdvanceToMilling` was never set because design
   was internal)*. Admin manually opens **Assign to Milling Centre**, picks `Acme Mill Co.`
   (a *different* centre than would have designed it, purely because Acme has the best
   Ti-Base turnaround this month). → `ready_for_milling`.
4. → `milling_in_progress` → `milling_qc` → `dispatched` → `delivered`.

---

## 12. Notifications, activity log, billing — what plugs in unchanged vs. what's new

### 12.1 Notifications
- `notifyCaseStatusChanged` (`src/lib/notifications/notification-dispatcher.ts`) already
  derives the client-safe label purely from `serviceType` + `status` — **no change needed**,
  since the client label table is untouched (§10).
- New notification targets: when a case is assigned to a design partner, notify that centre's
  `milling_admin`/`milling_production` users (parallel to today's `CASE_ASSIGNED` notification
  to an internal `designerId`). When QC rejects a partner-designed case, notify the centre
  (parallel to today's `CASE_REJECTED` notification to `caseRecord.designerId`).
- Internal notification copy should include the centre name (e.g. "Case CAB-0512 assigned to
  Acme Mill Co. for design") — this is Admin/QC-facing only, so no privacy concern.

### 12.2 Activity log
- `logActivity` calls for `case.milling_assigned` (`milling-assign/route.ts:186`) get a sibling
  `case.design_partner_assigned` action, and the milling-portal status route's
  `case.milling_status_updated` gets a sibling `case.design_status_updated` for the design-phase
  transitions the centre makes. Same shape, same table (`activity_logs`), no new
  infrastructure.

### 12.3 Billing — no pricing-model change
Whether design was done in-house or by a partner **does not change what the dental lab is
billed.** The client-facing price is always looked up by `(clientId, category, subCategory,
serviceType)` off `service_catalog`/`client_price_list` (`src/lib/invoice.ts`) — that lookup is
completely independent of who actually performed the work. What's new is purely an **internal
cost** line: the `partnerRate` on the centre's own `milling_service_catalog` row for the
`design_only`/`design_milling` tab (already a column that exists — §3.4) becomes meaningful for
the first time, the same way `milling-implementation-plan.md`'s pricing-engine section already
described for the *milling* leg. No invoice-facing change; this is admin/analytics-only, per
the existing "partner cost never reaches the dental lab" rule.

---

## 13. Edge cases

### 13.1 Assignment & eligibility
1. **No eligible centre exists** for a case's category/subCategory under the needed flow tab —
   the "Assign to Design Partner" picker shows an empty list with a message, same UX as an
   empty designer-allocation list would; admin falls back to `internal`.
2. **Centre is enabled for `design_milling` but has no `design_only` row** — cannot be picked
   to design a `design_only` case, even if otherwise a great partner; the two catalogs are
   independent (§9, point 2).
3. **Admin re-runs "Assign to Design Partner" on a case already assigned to Centre A**,
   picking Centre B instead, while status is still `allocated_to_designer` (Centre A hasn't
   started) — allowed; overwrites `designCenterId`; Centre A's portal view of the case
   disappears (it never showed up as "in progress" for them); notify Centre A the assignment
   was withdrawn.
4. **Admin tries to reassign design mid-flight** (status already `in_progress` at Centre A) —
   blocked with a clear error ("Cannot reassign design after work has started — put the case
   On Hold first"), mirroring the existing `EDITABLE_STATUSES` philosophy for client-side
   edits. On Hold → reassign → resume is the supported path. **Confirmed (§16): no direct
   reassign-while-in-progress action — On Hold first is required.**
5. **A centre's `active` flag flips to `false` while they have in-flight design work** — the
   centre's login is disabled going forward, but this plan does **not** auto-yank in-flight
   assignments (matches how the production leg already behaves — deactivating a centre today
   doesn't touch existing `milling_case_assignments` rows either). Admin must manually
   reassign if the case is stuck.
6. **`monthlyCapacity` on a `milling_service_catalog` row is exceeded** — informational only,
   same as today's production-side behavior (`routing-engine.ts`'s comment at the top
   confirms there is no hard capacity gate anywhere yet); the design picker likewise does not
   hard-block on capacity, only surfaces current load the same way `AssignMillingCenterDialog`
   already shows `currentLoad` for production.

### 13.2 QC rejection / rework loop
7. **QC rejects a Flow-1/3 case** — always returns to the *same* centre
   (`designCenterId` unchanged), never silently reassigned — matches the internal-designer
   behavior of `route.ts` (a rejected case stays with the same `designerId`).
8. **QC wants to pull a partner-designed case back to an internal designer instead** (e.g. the
   centre is unresponsive) — supported as a manual "Reassign to internal designer" action:
   clears `designCenterId`, sets `designSource='internal'`, sets `designerId`, status stays/
   returns to `allocated_to_designer`/`in_progress` as appropriate. The centre is notified their
   assignment was withdrawn; whatever partial output they uploaded remains in `case_files`/
   `outputFile` history for the internal designer to see (or discard).
9. **Client requests changes (`change_requested`) on a Flow-1 `design_only` case** after
   `submitted_to_client`** — per today's `design_only` flow this typically loops through
   `client_feedback` back to `in_progress`. If the original designer was a partner centre, the
   rework must return to that same centre (`designSource` doesn't change just because the case
   briefly touched a client-approval step) — same rule as #7.

### 13.3 Hold / cancel
10. **Admin/QC places a partner-designed case On Hold** — allowed (`admin`/`qc` can already
    hold almost any non-terminal status). The centre's portal must show a clear "On Hold" state
    and hide the "Start Design"/"Submit for Review" actions while held, exactly mirroring how
    the client portal already disables actions during hold.
11. **Client cancels a case** (`cancelled`, only from pre-design statuses per
    `canCancelCase`) — if this happens after a design partner was already assigned but before
    they started (`allocated_to_designer`), the centre must be notified the case was pulled and
    it must disappear from their queue.
12. **Case cancelled *after* a Flow-3 centre already started milling** — out of scope for a
    "before design starts" cancellation path per `canCancelCase`'s existing eligibility window;
    no new behavior needed beyond what already exists for `design_milling` cancellation
    generally.

### 13.4 Flow 3 specifics
13. **Centre with `autoAdvanceToMilling=true` becomes inactive between design-approval and the
    auto-triggered production hand-off** (e.g. deactivated the same day QC approves) — the
    auto-advance step must re-validate the centre is still `active` before flipping to
    `ready_for_milling`; if not, fall back to **not** auto-advancing and instead surface the
    case to admin as "Design approved — needs a milling centre" (i.e. gracefully degrade Flow 3
    into Flow 1's deferred path rather than assigning a dead centre).
14. **Admin or QC wants to override Flow 3's committed centre for the production leg** (e.g.
    Centre X designed it well but is overloaded for milling this month) — allowed as a manual
    override at the moment of auto-advance or any time before `milling_in_progress` actually
    starts; functionally identical to Flow 1's "assign milling separately" action, just
    overriding a default instead of making a first choice. **Confirmed (§16): both `admin` and
    `qc` may perform this override** — same pair of roles already allowed to make the original
    design-partner assignment (§6.1), so there's no new role split to reason about.
15. **A `design_only` case has `autoAdvanceToMilling` accidentally set** — must be rejected at
    the API level; the checkbox is only ever shown/accepted for `serviceType = design_milling`
    (§7.3), and the backend re-validates this rather than trusting the UI to hide it correctly.

### 13.5 Data integrity / display
16. **A case shows `designSource='partner'` but `designCenterId` is null** (e.g. a bug, or a
    row cleared without updating the denormalized flag) — the admin UI must fail safe: treat
    it as `internal`/unknown and show a warning badge rather than crashing on a null centre
    lookup. This is exactly why §5.2 stresses `designSource` is a read-optimization, not a
    second source of truth — anything reading it should tolerate drift.
17. **`milling_service_catalog` row backing an *already-assigned* centre gets deactivated
    mid-case** (admin turns off that service after assigning it) — the in-flight assignment is
    unaffected (no re-validation after assignment, same as production assignments today); only
    *future* eligibility checks (§9) exclude the centre going forward.
18. **Migrating existing data**: every case created before this change has `designSource`
    defaulting to `'internal'` and `milling_case_assignments` (if any) implicitly represents a
    production-only row — a backfill sets `productionCenterId = millingCenterId` and
    `designCenterId = null` for every existing row, `scope = 'milling'` for all of them. No
    existing case is reinterpreted as partner-designed.

### 13.6 Permissions / abuse
19. **A `milling_production` user (not `milling_admin`) tries to reassign the case to a
    different QC lead or edit `category`/`subTypeData`** — must be forbidden, mirroring exactly
    the existing designer-role restriction in `route.ts` ("Designers cannot modify core case
    properties or administrative assignments").
20. **A centre user tries to act on a case assigned to a *different* centre** (guessing/
    enumerating case IDs) — already impossible by construction since every milling-portal route
    scopes by `auth.millingCenterId` joined against the assignment row; the same join must be
    used for the new design-phase actions (§6.2), not a bare `caseId` lookup.
21. **Two milling_admin users at the same centre act on the same case near-simultaneously**
    (e.g. both click Submit for Review) — no new race beyond what already exists for
    internal designers today; not addressed differently here.

---

## 14. Out of scope for this plan (explicitly not being built)

- Centre self-service management of their own `design_only`/`design_milling` catalog rows —
  per `milling-center-admin-level-plan.md`, catalog management is **admin-only** today; this
  plan doesn't change who edits `milling_service_catalog`, only what reads it.
- Automatic routing-rule-based recommendation for the *design* picker (mentioned as optional in
  §9) — the picker can ship with a manual filtered list first; recommendation parity with the
  production picker (`routeCase()`) can follow later without touching the flows themselves.
- Any change to `milling_only`'s flow — it has no design phase and is untouched by this plan.
- Any client-facing UI change whatsoever — confirmed throughout §7/§10/§12.

---

## 15. Suggested build order (once approved — no code written yet)

1. **Schema**: extend `milling_case_assignments` (§5.1), add the new
   `case_center_assignment_history` table (§5.1a), add `cases.designSource` (§5.2), backfill
   migration for existing rows (§13.5 #18).
2. **Eligibility helper**: one shared function implementing §9's 3-part check, used by both the
   new design picker and the fix to `AssignMillingCenterDialog`.
3. **Guards**: extend `case-status-transitions.ts` and the milling-portal auth path (§6.2) to
   authorize the new design-phase transitions, scoped by `designCenterId` instead of
   `designerId`.
4. **APIs**: "Assign to Design Partner" endpoint (parallel to `milling-assign/route.ts`),
   writing a `case_center_assignment_history` row on every assign/reassign/withdraw/
   auto-advance in the same transaction as the current-state update; extend
   `PATCH /api/milling/cases/[id]/status` (or a new sibling route) to accept design-phase
   statuses; auto-advance logic triggered on QC approval when `autoAdvanceToMilling=true`.
5. **Admin UI**: the assignment dialog + `[Partner: …]` label suffix + admin case-list
   filter/badge for `designSource` + a per-case "Assignment History" panel reading
   `case_center_assignment_history` (§5.1a) so admin/QC can see every past design/production
   centre a case has been through, not just the current one.
6. **Milling portal UI**: design queue view, case detail's design actions (Start Design,
   upload output/preview, Submit for Review), read-only states for On Hold/Awaiting QC.
7. **Notifications + activity log** wiring (§12.1–12.2).
8. **Fix the existing eligibility gap** in `AssignMillingCenterDialog` (§3.4/§9) as part of the
   same pass, since it shares the eligibility helper from step 2.

---

## 16. Decisions confirmed

All five open questions have been answered. This plan has been updated throughout to reflect
them (search for "Confirmed (§16)" for the exact spots touched):

1. **Naming** — confirmed as proposed: **"Assign to Design Partner"**, **"Design Queue"**,
   **"This centre will also mill the case."** Used consistently in §6.1, §7.2, §7.3, §11.
2. **QC-lead pre-assignment (§6.1)** — confirmed **hard requirement**, no round-robin/default
   fallback. A case cannot be handed to a design partner without a `qcId` set in the same
   action.
3. **Flow 3 override (§13.4 #14)** — confirmed **both `admin` and `qc`** may override a
   committed production centre, matching who can make the original design-partner assignment.
4. **Reassigning design mid-flight (§13.1 #4)** — confirmed **On Hold first is required**; no
   direct reassign-while-`in_progress` action.
5. **History table (§5.1a)** — confirmed **in scope for this effort**, not deferred. The new
   `case_center_assignment_history` table (§5.1a) is now part of the schema changes (§15 step
   1) and gets a supporting admin UI panel (§15 step 5), rather than relying on `cases.timeline`
   alone.

---

**No code, schema, or UI has been modified. §16's questions are now answered — this document
is ready; implementation starts on your go-ahead.**
