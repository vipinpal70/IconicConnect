profiles
├── userType: dental_lab
│ ├── role: client ← registers via /auth/sign-up (UI)
│ └── role: subuser ← created by a client via dashboard
│
└── userType: dental_lab_service
├── role: admin ← registers via /api/admin/register (hidden URL)
├── role: qc ← created by admin via /api/admin/register
├── role: account_manager
└── role: designer

admin

- user
  - add admin level user here
- member
  - manage member -add,edit,delete
- client
  - manage client and their profile


## Product scope: Design only

Iconic and its clients deliver **design only** — there is no milling, milling-centre portal,
partner designer or physical shipping in this repo.

Portals: `admin`, `ops` (qc / designer / account_manager), `client`.

Case flow (single): Submitted → In Validation → In Design → Internal QC → Client Review →
Approved (Completed). Source of truth: `src/lib/case-status-mapping.ts`.

Pricing: one service catalog (`service_catalog`) with per-client overrides (`client_price_list`).
The legacy `service_type` column is pinned to `design_only` until it is dropped
(see `design-only-removal-plan.md`, Phase 7).
