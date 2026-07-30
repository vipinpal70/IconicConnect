# Milling Implementation Plan — IconicConnect (Updated)

---

## Corrected Business Model

### Three Entities in the System

| Entity                   | Role                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| **Dental Lab (client)**  | Submits cases, pays Iconic for services                                                     |
| **Iconic (admin)**       | Receives cases, does all designing, manages routing, handles billing                        |
| **Milling Center (new)** | External manufacturing partner — receives cases from Iconic, mills, and ships to dental lab |

---

### Two Services Offered to Dental Labs

| Service              | What Happens                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Design Only**      | Iconic's team designs the case and delivers digital files to the dental lab                                     |
| **Design + Milling** | Iconic designs the case, then routes it to a Milling Center for milling and physical delivery to the dental lab |

> Note: Iconic does not have any milling capability in-house — they only offer design.
> All milling (and shipping of the physical product) is handled entirely by Milling
> Centers, external partners that expand Iconic's milling capacity. Iconic assigns a
> Milling Center to a Design+Milling case the same way it assigns a designer or QC —
> the selection is driven by the milling center's routing rules.

---

### Case Flow — Design + Milling

```
Dental Lab submits case (Design + Milling)
        ↓
Iconic team validates scan
        ↓
Iconic designer creates the design
        ↓
Admin assigns case to a Milling Center
(admin sees routing rules and picks/confirms center)
        ↓
Milling Center receives design files + dental lab name/shipping address
(needed to ship the physical product — no other client PII, no pricing)
        ↓
Milling Center: mills → QC → packages → ships
        ↓
Dental Lab receives physical product
(shown as "Fulfilled by Iconic Dental" — milling center is hidden)
```

---

### What a Milling Center Can Do in Their Portal

1. **Manage their service catalog** — what types of cases they can mill (e.g. Zirconia Crown, E.max, Nightguard)
2. **Set their pricing per service** — the rate they charge Iconic per unit
3. **Receive and work on assigned cases** — see design files, update status, enter shipment info
4. **Raise flags / support tickets** — communicate with Iconic team about a specific case

### What a Milling Center CAN See (and why)

- **Dental lab name + shipping address** — needed to ship the physical product to the correct destination

### What a Milling Center CANNOT See

- Routing rules (those are admin-only)
- Dental lab emails, phones, or any other PII beyond name + shipping address
- Other milling centers' cases
- Iconic's pricing — they only see the rate they themselves charge Iconic, never what Iconic charges the dental lab

---

### Pricing Architecture (Two Price Lists + One Internal Cost)

Dental labs are priced off **two parallel price lists**, same structure, different numbers:

| Price List           | Applies To             | Structure                                                                                              |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| **Design**           | Design Only cases      | Existing `serviceCatalog` / `clientPriceList` (category, subCategory, unitType, price)                 |
| **Design + Milling** | Design + Milling cases | Same structure, same category/subCategory grouping — just a second, higher price set directly by admin |

A case's `serviceType` (`design_only` | `design_milling`) determines which price list the invoice line item is pulled from. There is no computed markup — admin sets the Design+Milling price directly, the same way they set Design prices today.

Separately, each **Milling Center's own rate** (what they charge Iconic per service, set by them in their portal) is tracked for internal cost/margin visibility only — it does NOT drive the client-facing price automatically.

| Layer                                             | Who Sets It                     | Who Sees It                                                       |
| ------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| **Milling Center's rate (partner cost)**          | Milling Center, in their portal | Milling center + Iconic admin (cost/margin analytics only)        |
| **Design + Milling price (what dental lab pays)** | Iconic admin sets directly      | Admin (on invoices); dental lab sees only the resulting line item |

The dental lab never sees the partner cost or any margin — they just see a line item on their invoice.

---

## Phase 1 — Database Schema

### 1A. Extend `src/db/schema/profile.ts`

Add to `userTypeEnum`:

- `'milling_portal'`

Add to `userRoleEnum`:

- `'milling_admin'` — can manage services, pricing, view cases, and manage team members of their center
- `'milling_production'` — can view and update case status/shipment only
- `'milling_support'` — can view cases and raise support tickets

Add column to `profiles` table:

- `millingCenterId uuid` (nullable FK → millingCenters) — set for all milling portal users, links them to their center

---

### 1B. Extend `src/db/schema/case.ts`

**New values for `caseStatusEnum`** (added after `approved`):

```
'ready_for_milling'     // Design approved, package sent to milling center
'milling_in_progress'   // Milling center has started manufacturing
'milling_qc'            // QC at milling center
'packaging'             // Milling center is packaging
'dispatched'            // Shipped by milling center — carrier has picked up
```

> Note: `delivered` already exists. Milling cases use the same `delivered` status.

**New column on `cases` table:**

- `serviceType varchar` — `'design_only'` | `'design_milling'` (default: `'design_only'`)
- Only two options because dental labs now only see Design Only or Design+Milling

**Update all status label maps:**

| Status                | Client sees   | Admin/Internal sees |
| --------------------- | ------------- | ------------------- |
| `ready_for_milling`   | In Production | Ready for Milling   |
| `milling_in_progress` | In Production | Milling in Progress |
| `milling_qc`          | In Production | Milling QC          |
| `packaging`           | Packaging     | Packaging           |
| `dispatched`          | Shipped       | Dispatched          |

Client NEVER sees "milling" anywhere — it appears as "In Production", "Packaging", or "Shipped".

**Update lifecycle steps:**
Add `'In Production'` between `'Completed'` and `'Pending Client Approval'` for Design+Milling cases.

---

### 1C. New File: `src/db/schema/milling.ts`

**Four new tables:**

---

**`millingCenters`** — the partner organizations registered in the system

| Column                | Type      | Notes                      |
| --------------------- | --------- | -------------------------- |
| id                    | uuid PK   |                            |
| name                  | varchar   | Company/center name        |
| contactName           | varchar   |                            |
| email                 | varchar   |                            |
| phone                 | varchar   |                            |
| city                  | varchar   |                            |
| country               | varchar   |                            |
| state                 | varchar   |                            |
| active                | boolean   | Admin can pause a center   |
| onboardedAt           | date      | When Iconic onboarded them |
| createdAt / updatedAt | timestamp |                            |

---

**`millingServiceCatalog`** — services that a milling center offers (set by the milling center themselves)

| Column                | Type                     | Notes                                                                                                                          |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| id                    | uuid PK                  |                                                                                                                                |
| millingCenterId       | uuid FK → millingCenters |                                                                                                                                |
| category              | varchar                  | Matches case category (e.g. "Crown & Bridge")                                                                                  |
| subCategory           | varchar                  | Specific restoration (e.g. "Zirconia Crown")                                                                                   |
| unitType              | varchar                  | `'per_tooth'` \| `'per_arch'` \| `'per_case'`                                                                                  |
| partnerRate           | numeric                  | What the milling center charges Iconic — internal cost only, never used to auto-compute the client-facing Design+Milling price |
| turnaroundDays        | integer                  | Expected TAT for this service                                                                                                  |
| isActive              | boolean                  | Center can disable a service                                                                                                   |
| notes                 | text                     | Any service-specific notes                                                                                                     |
| createdAt / updatedAt | timestamp                |                                                                                                                                |

---

**No markup table.** The client-facing Design+Milling price is not computed from the milling center's partner rate — it lives in the existing price-list tables instead (see below). `millingServiceCatalog.partnerRate` is used only for internal cost/margin reporting.

---

### 1C-bis. Extend `src/db/schema/price-list.ts` — Two Price Lists

To support "Design" and "Design + Milling" as two parallel price lists with the same category/subCategory structure but different prices:

**`serviceCatalog`**

- Add column: `serviceType varchar` — `'design_only'` | `'design_milling'` (default: `'design_only'`)
- Change unique constraint from `(category, subCategory)` to `(category, subCategory, serviceType)`
- For every existing `(category, subCategory)` row (implicitly `design_only`), a matching `design_milling` row is added with its own `defaultPrice`, set by admin

**`clientPriceList`**

- No column changes needed — `catalogItemId` already points at a specific `serviceCatalog` row, and that row now carries the `serviceType`. A client automatically gets a separate override slot for the Design and the Design+Milling price of the same category/subCategory.
- `seedClientPriceList` must seed both `serviceType` rows per category/subCategory when a client is onboarded

**`getUnitPrice()` in `src/lib/invoice.ts`**

- Add a `serviceType` parameter and match on it (alongside `category` + `subCategory`) when looking up the catalog/client-price row, so a Design+Milling case pulls its price from the `design_milling` row instead of `design_only`

---

**`millingRoutingRules`** — admin-only rules that determine which center gets a case (milling center cannot see these)

| Column                  | Type                     | Notes                                                                   |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------- |
| id                      | uuid PK                  |                                                                         |
| name                    | varchar                  | Rule label                                                              |
| priority                | integer                  | Lower = higher priority (evaluated first)                               |
| scope                   | jsonb                    | `{ countries, states, excludeStates, clients, products, restorations }` |
| millingCenterId         | uuid FK → millingCenters | Primary center                                                          |
| fallbackMillingCenterId | uuid FK (nullable)       | Used if primary is over capacity or inactive                            |
| active                  | boolean                  |                                                                         |
| createdAt / updatedAt   | timestamp                |                                                                         |

---

**`millingCaseAssignments`** — the live assignment between a case and a milling center

| Column                | Type                     | Notes                                                                                                 |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| id                    | uuid PK                  |                                                                                                       |
| caseId                | uuid FK → cases (unique) | One assignment per case                                                                               |
| millingCenterId       | uuid FK → millingCenters |                                                                                                       |
| millingStatus         | varchar                  | `ready_for_milling` → `milling_in_progress` → `milling_qc` → `packaging` → `dispatched` → `delivered` |
| carrier               | varchar                  | UPS, FedEx, DHL, etc.                                                                                 |
| trackingNumber        | varchar                  |                                                                                                       |
| shipmentEta           | date                     |                                                                                                       |
| notes                 | text                     | Design notes Iconic sends to the center (no client PII)                                               |
| shipToName            | varchar                  | Dental lab name — needed by the milling center to ship the physical product                           |
| shipToAddress         | text                     | Dental lab shipping address — needed by the milling center to ship the physical product               |
| assignedAt            | timestamp                |                                                                                                       |
| createdAt / updatedAt | timestamp                |                                                                                                       |

> `shipToName` / `shipToAddress` are the only client-identifying fields ever exposed to a milling center. Everything else about the dental lab (email, phone, other PII, pricing) is stripped.

---

### 1D. Migration SQL

New file: `src/db/migrations/0046_milling_schema.sql`

Covers:

- Add `milling_portal` to `user_type` enum
- Add `milling_admin`, `milling_production`, `milling_support` to `user_role` enum
- Add `milling_center_id` column to `profiles`
- Add milling statuses to `case_status` enum
- Add `service_type` column to `cases`
- Add `service_type` column to `service_catalog`, update its unique constraint to `(category, sub_category, service_type)`, and insert a `design_milling` row for every existing `(category, sub_category)`
- Add `ship_to_name` / `ship_to_address` columns to `milling_case_assignments`
- Create all four new milling tables

---

### 1E. Update `src/db/schema/index.ts`

Add: `export * from './milling'`

---

## Phase 2 — Auth & Role Configuration

### 2A. `src/lib/auth/role.ts`

```ts
milling_portal: ["milling_admin", "milling_production", "milling_support"];
```

### 2B. `src/app/api/sign-in/route.ts`

Add redirect for milling roles:

```ts
case 'milling_admin':
case 'milling_production':
case 'milling_support':
  redirectUrl = '/milling/dashboard'
  break
```

### 2C. Milling User Creation

Admin creates milling users from the milling center management page.

New route: `src/app/api/admin/milling/users/route.ts`

- Admin picks a milling center, enters user name/email/role
- System creates Supabase auth user + profile row with `userType = 'milling_portal'` and `millingCenterId` set
- New user receives email with credentials (reuses existing mailer)
- On first login → redirected to `/milling/dashboard`

---

## Phase 3 — Server-Side Libraries

### 3A. `src/lib/milling/routing-engine.ts`

Used by Iconic admin when assigning a milling center to a case.

```
Input: case info (category, subCategory, client state/country)
Output: recommended milling center + fallback based on routing rules + capacity
```

Logic:

1. Load active routing rules ordered by priority
2. For each rule, check if the case matches the scope
3. Pick the primary center if active and under capacity
4. Otherwise pick the fallback
5. Return the recommendation (admin can override manually)

### 3B. `src/lib/milling/pricing-engine.ts`

Used by admin analytics only — **not** to compute the client-facing price (that's a flat lookup via `getUnitPrice()`, same as Design pricing). This engine exists purely to report margin.

```
Input: millingCenterId + category + subCategory + clientId
Output: { partnerRate, clientPrice, margin }
```

`partnerRate` comes from `millingServiceCatalog`. `clientPrice` comes from the existing price-list lookup (`getUnitPrice(..., serviceType: 'design_milling')`). Neither number is ever returned to the dental lab or the milling center — this output is admin/analytics-only.

---

## Phase 4 — Admin API Routes

All routes under `/api/admin/milling/` require `admin` role.

| Route                             | Methods            | Purpose                                                                           |
| --------------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| `/api/admin/milling/centers`      | GET, POST          | List all centers / onboard a new center                                           |
| `/api/admin/milling/centers/[id]` | GET, PATCH, DELETE | View / edit / deactivate a center                                                 |
| `/api/admin/milling/routing`      | GET, POST          | List routing rules / add new rule                                                 |
| `/api/admin/milling/routing/[id]` | PATCH, DELETE      | Edit / remove a routing rule                                                      |
| `/api/admin/milling/analytics`    | GET                | Per-center stats: cases, partner cost, customer revenue, margin, TAT, remake rate |
| `/api/admin/milling/cases`        | GET                | All Design+Milling cases with their assignment info                               |
| `/api/admin/milling/users`        | GET, POST          | List / create milling center users                                                |
| `/api/cases/[id]/milling-assign`  | GET, POST          | Get current assignment / assign case to a milling center                          |

> The Design+Milling price list itself is **not** managed here — it's set via the existing `/api/admin/clients/[id]/price-list` and catalog-default routes, extended to accept `serviceType`, same UI pattern as the Design price list.

---

## Phase 5 — Milling Portal API Routes

All routes under `/api/milling/` require a `milling_*` role. All data is scoped to `profile.millingCenterId`. **Client PII is stripped from every response, except the dental lab's name + shipping address, which the milling center needs to ship the physical product.**

| Route                              | Methods       | Who Can Call                      | Purpose                                       |
| ---------------------------------- | ------------- | --------------------------------- | --------------------------------------------- |
| `/api/milling/me`                  | GET           | all milling roles                 | Current user + center profile                 |
| `/api/milling/dashboard`           | GET           | all milling roles                 | Case status buckets + capacity stats          |
| `/api/milling/services`            | GET, POST     | milling_admin only                | List / add services this center offers        |
| `/api/milling/services/[id]`       | PATCH, DELETE | milling_admin only                | Edit / remove a service                       |
| `/api/milling/cases`               | GET           | all milling roles                 | Cases assigned to this center (no client PII) |
| `/api/milling/cases/[id]`          | GET           | all milling roles                 | Case detail stripped of client identity       |
| `/api/milling/cases/[id]/status`   | PATCH         | milling_admin, milling_production | Update milling status                         |
| `/api/milling/cases/[id]/shipment` | POST          | milling_admin, milling_production | Record carrier + tracking number              |
| `/api/milling/cases/[id]/files`    | POST          | milling_admin, milling_production | Upload manufacturing / QC photos              |
| `/api/milling/support`             | GET, POST     | all milling roles                 | View / open support tickets with Iconic       |

**Privacy enforcement in API:**

- Only expose `shipToName` / `shipToAddress` from `millingCaseAssignments` — never the underlying `clientId`, `email`, `phone`, or any other profile field
- Always strip any other client-identifying info before sending a response
- Never return pricing (`partnerRate`, client price, margin) from any milling-portal endpoint
- Milling center knows: case ID, restoration type, tooth numbers, design notes from Iconic, due date, and (for shipping) the dental lab's name + address

---

## Phase 6 — Admin Milling UI Pages

New folder: `src/app/admin/milling/`

All pages share a `MillingSubNav` component at the top with tabs:
**Overview / Centres / Routing / Pricing / Analytics**

> Note: Integrations tab is removed from MVP. That is a future LMS sync feature.

| Page File            | URL                        | Content                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page.tsx`           | `/admin/milling`           | Redirect to `/admin/milling/overview`                                                                                                                                                                                                                                                                                                          |
| `overview/page.tsx`  | `/admin/milling/overview`  | KPI cards (active centres, network capacity %, active milling cases, delivered count) + card per centre (capacity bar, TAT, on-time %, remake %) + client visibility notice                                                                                                                                                                    |
| `centers/page.tsx`   | `/admin/milling/centers`   | Table of all centres (name, contact, city, active toggle, edit button) + "Onboard Centre" dialog + per-center user management                                                                                                                                                                                                                  |
| `routing/page.tsx`   | `/admin/milling/routing`   | Priority-ordered routing rules — each card shows scope (country/state/product/client chips), primary center, fallback center — Add/Edit/Delete rule                                                                                                                                                                                            |
| `pricing/page.tsx`   | `/admin/milling/pricing`   | Two-panel view: left = milling centers' partner rates (read-only, set by them, for cost reference), right = the Design+Milling client price list (reuses `PriceListTable`/`ClientPriceListModal` filtered to `serviceType: 'design_milling'`) where admin sets prices directly. Margin (client price − partner rate) shown for reference only. |
| `analytics/page.tsx` | `/admin/milling/analytics` | KPIs (revenue, gross margin, on-time %, remake rate) + charts: cases per centre, revenue vs partner cost, TAT breakdown, product mix pie, quality trend lines                                                                                                                                                                                  |

### Update `src/components/AdminSidebar.tsx`

Add nav item visible only to `admin` role:

- Label: "Milling"
- Icon: `Factory` (from lucide-react)
- URL: `/admin/milling/overview`
- Position: between Team and Tutorials

---

## Phase 7 — Milling Portal Pages

New section: `src/app/milling/`

### New Components

**`src/components/MillingLayout.tsx`**

- SidebarProvider wrapping MillingSidebar + header
- Header has bell icon for notifications
- Branding shows center name + "Iconic Connect Partner" label

**`src/components/MillingSidebar.tsx`**

- Factory icon + center name in header
- Nav: Dashboard / Assigned Cases / Services / Pricing / Support
- Footer: logged-in user name + role + logout button

---

### Pages

| File                  | URL                   | What it Shows                                                                                                                                                                                                                                                          |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout.tsx`          | wrapper               | MillingLayout wrapping all children                                                                                                                                                                                                                                    |
| `page.tsx`            | `/milling`            | Redirect to `/milling/dashboard`                                                                                                                                                                                                                                       |
| `dashboard/page.tsx`  | `/milling/dashboard`  | 5 stat cards (Ready for Milling / In Production / Milling QC / Packaging / Shipped) + capacity bar (current load / monthly capacity) + avg TAT + on-time % + remake rate + recent notifications list                                                                   |
| `cases/page.tsx`      | `/milling/cases`      | Table: Case ID, Restoration, Tooth Numbers, Model Required, Status badge, Due Date, Open + Download buttons. Search by case ID or restoration. Filter by milling status.                                                                                               |
| `cases/[id]/page.tsx` | `/milling/cases/[id]` | Case specs (restoration, type, model required, teeth, due date, Iconic's design notes) + Design file download button + Manufacturing file upload + Status update dropdown + Shipment entry (carrier, tracking number) + Raise flag / clarification textarea + Timeline |
| `services/page.tsx`   | `/milling/services`   | Table of services this center offers (category, restoration, unit type, TAT, rate they charge Iconic) + Add / Edit / Delete service + toggle active                                                                                                                    |
| `support/page.tsx`    | `/milling/support`    | New ticket form (subject + message) + ticket history table — tickets auto-include Iconic Support as participant                                                                                                                                                        |

---

## Phase 8 — Case Flow Integration

### 8A. Case Submission — `src/components/AddCaseDialog.tsx`

Replace existing service type options with exactly two:

- **Design Only** — Iconic delivers design files digitally
- **Design + Milling** — Iconic designs, then mills and ships physical product

When "Design + Milling" is selected, `serviceType = 'design_milling'` is saved on the case.

---

### 8B. Admin Case List — `src/app/admin/cases/page.tsx`

- Add filter for "Design+Milling" cases
- In the status column, show a small `Factory` icon badge on Design+Milling cases
- When in a milling stage, show the assigned center name next to the status badge

---

### 8C. Admin Case Detail — `src/app/admin/cases/[id]/page.tsx`

Add a **"Milling"** tab (visible only when `serviceType === 'design_milling'`):

**Before assignment:**

- "Assign to Milling Center" button
- Runs routing engine: shows recommended center with capacity info
- Admin can accept the suggestion or manually pick any active center
- When assigning, admin writes design notes (sent to milling center — no client info)

**After assignment:**

- Assigned center name (no clickthrough to center's details from case)
- Current milling status
- Milling-stage timeline (shows each milling status update with timestamp)
- Shipment info: carrier, tracking number, ETA
- Button to re-assign to a different center if needed

---

### 8D. Client Case Detail — `src/app/client/cases/[id]/page.tsx`

- `ready_for_milling`, `milling_in_progress`, `milling_qc` → show as **"In Production"**
- `packaging` → show as **"Packaging"**
- `dispatched` → show as **"Shipped"**
- Timeline shows: "Design completed", "Sent to production", "Packaging", "Shipped by Iconic" — no mention of milling center
- NO milling center name, tracking details exposure until Iconic explicitly shares shipment info

---

## Phase 9 — Billing Integration

### Pricing Flow for Design+Milling Cases

1. Milling center sets their rate in their portal (e.g. Zirconia Crown = $28/tooth) — internal cost, informs admin's decision but isn't auto-applied
2. Admin sets the Design+Milling price directly on the `design_milling` price list (e.g. Zirconia Crown = $45/tooth), same UI as the existing Design price list
3. When admin generates an invoice for a dental lab, both line items come from the same lookup, differentiated by the case's `serviceType`:
   - Design Only case → `getUnitPrice(clientId, category, subCategory, 'design_only')`
   - Design + Milling case → `getUnitPrice(clientId, category, subCategory, 'design_milling')`

### Changes Needed

- `src/lib/invoice.ts` — `getUnitPrice()` and `buildInvoiceItems()` take the case's `serviceType` into account when matching a catalog/client-price row
- Admin invoice detail page — no change needed beyond the above; the Design+Milling line item is just another catalog line, no separate "partner cost" math on the invoice itself
- New admin-only section on invoice detail (optional) — shows the partner rate + margin for reference (role-gated to `admin` only), pulled from `src/lib/milling/pricing-engine.ts` for analytics purposes

---

## Recommended Build Order

| Order | Phase                           | Why This Order                               |
| ----- | ------------------------------- | -------------------------------------------- |
| 1     | Schema (Phase 1)                | Everything else depends on the database      |
| 2     | Migration + run                 | Tables must exist before any API call        |
| 3     | Auth + role config (Phase 2)    | Milling portal login must work               |
| 4     | Server libraries (Phase 3)      | Routing + pricing engines used by APIs       |
| 5     | Admin APIs (Phase 4)            | Admin manages centers before portal is built |
| 6     | Milling portal APIs (Phase 5)   | Portal endpoints                             |
| 7     | Admin milling UI (Phase 6)      | Admin can onboard centers and set markup     |
| 8     | Milling portal pages (Phase 7)  | Milling centers can log in and work          |
| 9     | Case flow integration (Phase 8) | End-to-end case flow wired up                |
| 10    | Billing integration (Phase 9)   | Pricing data must be configured first        |

---

## Complete File List

### New Files to Create

**Schema & Migration**

- `src/db/schema/milling.ts`
- `src/db/migrations/0046_milling_schema.sql`

**Server Libraries**

- `src/lib/milling/routing-engine.ts`
- `src/lib/milling/pricing-engine.ts`

**Components**

- `src/components/MillingLayout.tsx`
- `src/components/MillingSidebar.tsx`

**Admin Milling Pages**

- `src/app/admin/milling/page.tsx` (redirect)
- `src/app/admin/milling/overview/page.tsx`
- `src/app/admin/milling/centers/page.tsx`
- `src/app/admin/milling/routing/page.tsx`
- `src/app/admin/milling/pricing/page.tsx`
- `src/app/admin/milling/analytics/page.tsx`

**Milling Portal Pages**

- `src/app/milling/layout.tsx`
- `src/app/milling/page.tsx` (redirect)
- `src/app/milling/dashboard/page.tsx`
- `src/app/milling/cases/page.tsx`
- `src/app/milling/cases/[id]/page.tsx`
- `src/app/milling/services/page.tsx`
- `src/app/milling/support/page.tsx`

**Admin API Routes**

- `src/app/api/admin/milling/centers/route.ts`
- `src/app/api/admin/milling/centers/[id]/route.ts`
- `src/app/api/admin/milling/routing/route.ts`
- `src/app/api/admin/milling/routing/[id]/route.ts`
- `src/app/api/admin/milling/analytics/route.ts`
- `src/app/api/admin/milling/cases/route.ts`
- `src/app/api/admin/milling/users/route.ts`
- `src/app/api/cases/[id]/milling-assign/route.ts`

**Milling Portal API Routes**

- `src/app/api/milling/me/route.ts`
- `src/app/api/milling/dashboard/route.ts`
- `src/app/api/milling/services/route.ts`
- `src/app/api/milling/services/[id]/route.ts`
- `src/app/api/milling/cases/route.ts`
- `src/app/api/milling/cases/[id]/route.ts`
- `src/app/api/milling/cases/[id]/status/route.ts`
- `src/app/api/milling/cases/[id]/shipment/route.ts`
- `src/app/api/milling/cases/[id]/files/route.ts`
- `src/app/api/milling/support/route.ts`

---

### Existing Files to Modify

| File                                 | What Changes                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/db/schema/profile.ts`           | Add `milling_portal` type, milling roles, `millingCenterId` column                                               |
| `src/db/schema/case.ts`              | Add milling statuses to enum, add `serviceType` column, update all label maps                                    |
| `src/db/schema/index.ts`             | Add `export * from './milling'`                                                                                  |
| `src/db/schema/price-list.ts`        | Add `serviceType` column to `serviceCatalog`, update unique constraint to `(category, subCategory, serviceType)` |
| `src/lib/price-list.ts`              | `seedClientPriceList` seeds both `serviceType` rows per category/subCategory                                     |
| `src/lib/auth/role.ts`               | Add `milling_portal` and its roles to ROLE_MAP                                                                   |
| `src/app/api/sign-in/route.ts`       | Add redirect for milling roles to `/milling/dashboard`                                                           |
| `src/components/AdminSidebar.tsx`    | Add "Milling" nav item (admin-only, Factory icon)                                                                |
| `src/components/AddCaseDialog.tsx`   | Replace service type options with Design Only / Design+Milling only                                              |
| `src/app/admin/cases/page.tsx`       | Add milling badge + filter for Design+Milling cases                                                              |
| `src/app/admin/cases/[id]/page.tsx`  | Add Milling tab with assignment + milling status + shipment                                                      |
| `src/app/client/cases/[id]/page.tsx` | Map milling statuses to "In Production" / "Packaging" / "Shipped" — hide all milling info                        |
| `src/lib/invoice.ts`                 | `getUnitPrice()` / `buildInvoiceItems()` take `serviceType` into account when pricing a case                     |

---

## Scope Summary

| Category                | Count                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| New files               | ~37                                                                                                   |
| Modified files          | ~13                                                                                                   |
| New DB tables           | 4 (`millingCenters`, `millingServiceCatalog`, `millingRoutingRules`, `millingCaseAssignments`)        |
| New DB columns          | 3 (on existing tables: `profiles.millingCenterId`, `cases.serviceType`, `serviceCatalog.serviceType`) |
| New case status values  | 5                                                                                                     |
| New service type values | 1 (`design_milling`, shared by `cases.serviceType` and `serviceCatalog.serviceType`)                  |
| New user roles          | 3                                                                                                     |
| New user type           | 1 (`milling_portal`)                                                                                  |
