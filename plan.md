# Status Mapping Plan - Admin and Client, 3 Case Flows

Branch: `phase2`

Source plan synced from:

- `service-catlog-manage-plan.md`

## 1. Confirmed Scope

This plan adds a flow-aware `status_mapping` for all three service flows:

1. `design_only`
2. `design_milling`
3. `milling_only`

It must support both viewer sides:

- Admin/internal side: operational labels and actions.
- Client/lab side: simplified labels and no milling-center identity or internal production details.

It must align with the service-catalog plan:

- `milling_only` becomes a real third case flow.
- No new `caseStatusEnum` values are required for Milling Only.
- Admin controls which flows each client can use via `profiles.enabledServiceTypes`.
- Client submission and price-list visibility are gated by enabled flows and service enablement.
- Milling centers never see pricing, and nothing in this plan reintroduces pricing to the milling portal.

## 2. Current State

Current branch state before implementation:

- `cases.serviceType` supports only `design_only` and `design_milling`.
- `CLIENT_STATUS_LABELS`, `INTERNAL_STATUS_LABELS`, `CASE_LIFECYCLE_STEPS`, and `CASE_STATUS_TO_LIFECYCLE_STEP` are global maps in `src/db/schema/case.ts`.
- These global maps are display helpers only. They do not validate legal status transitions.
- `milling_only` needs different wording for reused statuses. Example: `scan_received` should be "File Submitted" for the client, not "Case Submitted" or "Scan Received".
- `milling_only` skips all design-stage statuses and goes from file verification to milling assignment.

## 3. Status Mapping Module

Add one canonical flow-aware mapping module:

- `src/lib/case-status-mapping.ts`

Suggested public types:

```ts
export type ServiceType = 'design_only' | 'design_milling' | 'milling_only'
export type StatusViewer = 'admin' | 'client'
```

Suggested mapping shape:

```ts
export const STATUS_MAPPING = {
  design_only: {
    lifecycleSteps: [],
    statuses: {},
    skippedStatuses: [],
  },
  design_milling: {
    lifecycleSteps: [],
    statuses: {},
    skippedStatuses: [],
  },
  milling_only: {
    lifecycleSteps: [],
    statuses: {},
    skippedStatuses: [],
  },
} as const
```

Each status entry should expose:

```ts
{
  adminLabel: string
  clientLabel: string
  lifecycleStep: string
  clientVisible: boolean
  terminal?: boolean
  actionType?: 'normal' | 'exception' | 'client_action' | 'admin_action' | 'milling_action'
}
```

Helper APIs:

- `getStatusLabel(serviceType, status, viewer)`
- `getLifecycleSteps(serviceType)`
- `getLifecycleStep(serviceType, status)`
- `isStatusAllowedForFlow(serviceType, status)`
- `getSkippedStatuses(serviceType)`

Keep `caseStatusEnum` as the database truth. Use this module as the flow-aware display and validation truth.

## 4. Shared Status Rules

No new case statuses are required. Extend only `serviceTypeEnum`:

```ts
export const serviceTypeEnum = pgEnum('service_type', ['design_only', 'design_milling', 'milling_only'])
```

Milling Only uses these existing statuses:

- `scan_received`
- `scan_verified`
- `scan_not_verified`
- `on_hold`
- `ready_for_milling`
- `milling_in_progress`
- `milling_qc`
- `packaging`
- `dispatched`
- `delivered`
- `cancelled`
- `client_reject`

Milling Only must not use these design-stage statuses:

- `allocated_to_designer`
- `in_progress`
- `internal_qc`
- `submitted_to_client`
- `client_feedback`
- `approved`
- `change_requested`

Existing cases must still render even if they contain legacy or unexpected statuses. Unknown statuses should fall back to the raw status string.

## 5. Design Only Mapping

Happy path:

`scan_received -> scan_verified -> allocated_to_designer -> in_progress -> internal_qc -> submitted_to_client -> approved`

Rework path:

`submitted_to_client -> change_requested -> client_feedback -> in_progress -> internal_qc -> submitted_to_client`

Exception path:

`scan_received|scan_not_verified|scan_verified -> on_hold -> scan_received`

Terminal exceptions:

`cancelled`, `client_reject`

| Raw status | Admin side label | Client side label | Lifecycle step | Notes |
|---|---|---|---|---|
| `scan_received` | Scan Received | Case Submitted | Submitted | Initial upload received. |
| `scan_not_verified` | Scan Rejected | In Validation | In Validation | Scan/input files are not usable yet. |
| `scan_verified` | Scan Verified | Validated | In Validation | Case can enter design. |
| `allocated_to_designer` | Allocated to Designer | In Design | In Design | Designer is assigned. |
| `in_progress` | In Progress | In Design | In Design | Design work is active. |
| `internal_qc` | Internal QC | Internal QC | Internal QC | Keep current client wording unless product wants softer "Quality Check". |
| `submitted_to_client` | Submitted to Client | Client Review | Pending Client Approval | Client can approve, request changes, or reject. |
| `change_requested` | Change Requested | Change Requested | Pending Client Approval | Client requested changes. |
| `client_feedback` | Client Feedback | Feedback | In Design | Admin accepted change request and sent back to design. |
| `approved` | Approved | Case Approved | Completed | Terminal success for Design Only. |
| `delivered` | Delivered | Completed | Completed | Legacy/optional terminal display. |
| `on_hold` | On Hold | On Hold | In Validation | Early pause only. |
| `cancelled` | Cancelled | Cancelled | Completed | Terminal cancellation. |
| `client_reject` | Rejected | Rejected | Completed | Terminal rejection from client review. |

Skipped for Design Only:

- `ready_for_milling`
- `milling_in_progress`
- `milling_qc`
- `packaging`
- `dispatched`

Lifecycle steps:

`Submitted -> In Validation -> In Design -> Internal QC -> Pending Client Approval -> Completed`

## 6. Design + Milling Mapping

Happy path:

`scan_received -> scan_verified -> allocated_to_designer -> in_progress -> internal_qc -> submitted_to_client -> approved -> ready_for_milling -> milling_in_progress -> milling_qc -> packaging -> dispatched -> delivered`

Rework and exception paths are the same as Design Only until client approval.

| Raw status | Admin side label | Client side label | Lifecycle step | Notes |
|---|---|---|---|---|
| `scan_received` | Scan Received | Case Submitted | Submitted | Initial upload received. |
| `scan_not_verified` | Scan Rejected | In Validation | In Validation | Scan/input files are not usable yet. |
| `scan_verified` | Scan Verified | Validated | In Validation | Case can enter design. |
| `allocated_to_designer` | Allocated to Designer | In Design | In Design | Designer is assigned. |
| `in_progress` | In Progress | In Design | In Design | Design work is active. |
| `internal_qc` | Internal QC | Internal QC | Internal QC | Current client label can remain. |
| `submitted_to_client` | Submitted to Client | Client Review | Internal QC | Client approval is required before milling; this remains an action state, not a separate lifecycle step. |
| `change_requested` | Change Requested | Change Requested | Internal QC | Client requested changes; this remains an action state, not a separate lifecycle step. |
| `client_feedback` | Client Feedback | Feedback | In Design | Admin accepted change request and sent back to design. |
| `approved` | Approved | Case Approved | In Production | Design is approved and the case is ready to move into production. |
| `ready_for_milling` | Ready for Milling | In Production | In Production | Admin assigned/prepared the case for milling. |
| `milling_in_progress` | Milling in Progress | In Production | In Production | Production has started. |
| `milling_qc` | Milling QC | In Production | In Production | Client never sees milling terminology. |
| `packaging` | Packaging | Packaging | Packaging | Packaging is now its own lifecycle step. |
| `dispatched` | Dispatched | Dispatched | Dispatched | Hide milling-center identity and internal shipment details from client. |
| `delivered` | Delivered | Delivered | Delivered | Terminal success. |
| `on_hold` | On Hold | On Hold | In Validation | Early pause only before design starts. |
| `cancelled` | Cancelled | Cancelled | Terminal Exception | Terminal cancellation. |
| `client_reject` | Rejected | Rejected | Terminal Exception | Terminal rejection from client review. |

Skipped for Design + Milling:

- None from the current enum, but production statuses must not be reachable before `approved`.

Lifecycle steps:

`Submitted -> In Validation -> In Design -> Internal QC -> In Production -> Packaging -> Dispatched -> Delivered`

Note: `submitted_to_client`, `change_requested`, and `approved` remain real action/status states, but they do not render as standalone lifecycle-bar steps for Design + Milling. Do not introduce a new database status or separate "Production Pending" status unless product asks for a client confirmation step later.

## 7. Milling Only Mapping

Happy path:

`scan_received -> scan_verified -> ready_for_milling -> milling_in_progress -> milling_qc -> packaging -> dispatched -> delivered`

Rejected file path:

`scan_received -> scan_not_verified -> on_hold or scan_received after client resubmission`

Milling Only reuses existing statuses but changes wording from scan/design language to file/production language.

| Raw status | Admin side label | Client side label | Lifecycle step | Notes |
|---|---|---|---|---|
| `scan_received` | Mill-Ready File Received | File Submitted | Submitted | Client uploaded a manufacture-ready file. |
| `scan_not_verified` | File Rejected | File Needs Review | In Validation | Uploaded file is not mill-ready. |
| `scan_verified` | File Verified | File Verified | In Validation | Admin verified the file is production-ready. |
| `ready_for_milling` | Ready for Milling | In Production | In Production | Admin assigns the milling center directly after verification. |
| `milling_in_progress` | Milling in Progress | In Production | In Production | Production has started. |
| `milling_qc` | Milling QC | In Production | In Production | Client sees production-safe wording only. |
| `packaging` | Packaging | Packaging | Packaging | Packaging is now its own lifecycle step. |
| `dispatched` | Dispatched | Dispatched | Dispatched | Shipment stage. |
| `delivered` | Delivered | Delivered | Delivered | Terminal success. |
| `on_hold` | On Hold | On Hold | In Validation | Early pause while the file/input is unresolved. |
| `cancelled` | Cancelled | Cancelled | Terminal Exception | Terminal cancellation before production starts. |
| `client_reject` | Rejected | Rejected | Terminal Exception | Exception only. Not part of the normal Milling Only flow. |

Skipped for Milling Only:

- `allocated_to_designer`
- `in_progress`
- `internal_qc`
- `submitted_to_client`
- `change_requested`
- `client_feedback`
- `approved`

Lifecycle steps:

`Submitted -> In Validation -> In Production -> Packaging -> Dispatched -> Delivered`

Client case detail should render friendlier timeline copy:

`File received -> Verified -> In Production -> Packaging -> Dispatched -> Delivered`

This is a presentation layer over the same lifecycle mapping. It must not require new enum values.

## 8. Admin Side Requirements

Admin status surfaces must call:

```ts
getStatusLabel(case.serviceType, case.status, 'admin')
```

Update these surfaces:

| Area | File | Required change |
|---|---|---|
| Status badge | `src/components/StatusBadge.tsx` | Accept optional `serviceType`; use flow-aware labels and existing/fallback colors. |
| Shared case detail | `src/components/CaseDetailView.tsx` | Pass `caseRecord.serviceType` to status and lifecycle helpers. |
| Admin case list | `src/app/admin/(dashboard)/cases/page.tsx` | Pass service type to badges and filters. Add `milling_only` filter option. |
| Ops case list | `src/app/(ops)/cases/page.tsx` | Same badge and filter updates if this view remains active. |
| Admin dashboard cards | `src/app/admin/(dashboard)/dashboard/page.tsx` | Use mapping helper for status labels. |
| Analytics buckets | `src/app/api/admin/analytics/delivery-status/route.ts` | Bucket with flow awareness so production statuses are not counted like design completion. |
| Milling assignment | `src/app/api/cases/[id]/milling-assign/route.ts` | Allow `design_milling` from `approved` and `milling_only` from `scan_verified`. |

Admin actions by flow:

| Flow | Admin allowed actions |
|---|---|
| `design_only` | Verify/reject scan, assign designer/QC, move design through QC, submit to client, handle change requests, complete on approval. |
| `design_milling` | Same as Design Only through `approved`, then assign milling center and monitor production statuses. |
| `milling_only` | Verify/reject mill-ready file, place on hold/cancel before production, assign milling center from `scan_verified`, monitor production statuses. No designer/QC assignment UI. |

Admin case detail for `milling_only`:

- Hide Designer and QC assignment fields.
- Do not show design deliverable approval actions.
- After `scan_verified`, show the same "Assign to Milling Center" action used by Design + Milling, just one lifecycle stage earlier.

## 9. Client Side Requirements

Client status surfaces must call:

```ts
getStatusLabel(case.serviceType, case.status, 'client')
```

Update these surfaces:

| Area | File | Required change |
|---|---|---|
| Case submission | `src/components/AddCaseDialog.tsx` | Render only the client's enabled service flows. Add Milling Only option and mill-ready file copy. |
| Client case list | `src/app/client/(dashboard)/cases/page.tsx` | Pass service type to `StatusBadge`; add `milling_only` handling in filters/bulk rows. |
| Client dashboard | `src/app/client/(dashboard)/dashboard/page.tsx` | Use flow-aware client labels. |
| Shared case detail | `src/components/CaseDetailView.tsx` | Use flow-specific lifecycle steps and hide skipped statuses. |
| Client timeline | `src/components/CaseDetailView.tsx` | Continue using `clientLabel` and `clientHidden`; generate labels from mapping where possible. |
| Client price list | `ClientPriceListModal.tsx` | Limit tabs to enabled flows and hide disabled services. |
| Notifications | `src/lib/notifications/notification-dispatcher.ts` | Notification copy should use client-safe labels. |

Client actions by flow:

| Flow | Client allowed actions |
|---|---|
| `design_only` | Hold/cancel before validation starts. During `submitted_to_client`, approve, request changes, or reject. |
| `design_milling` | Same as Design Only during design approval. After `approved`, no production status mutation from client. |
| `milling_only` | Hold/cancel before file verification starts. No design approval actions because Iconic produces no design in this flow. |

Client visibility gates from the service-catalog plan:

- Fetch enabled flows from `GET /api/client/service-types` or an existing profile payload.
- If only one flow is enabled, do not render the service-type radio group.
- Client price-list tabs must show only enabled flows.
- Client price-list rows must show only services where `serviceCatalog.isActive === true` and `clientPriceList.isEnabled === true`.
- These visibility gates affect new submissions and displayed prices only. Existing cases and invoices must still render.

## 10. Transition Guard Plan

Add a server-side transition guard so UI mapping and API behavior cannot drift.

Suggested file:

- `src/lib/case-status-transitions.ts`

Export:

- `canTransitionCaseStatus({ serviceType, role, currentStatus, targetStatus, actorId, caseRecord })`
- `getAllowedTargetStatuses({ serviceType, role, currentStatus, caseRecord })`

Important rules:

- `milling_only` must reject design-only statuses: `allocated_to_designer`, `in_progress`, `internal_qc`, `submitted_to_client`, `change_requested`, `client_feedback`, `approved`.
- `design_only` must reject milling production statuses for new transitions.
- `design_milling` allows production statuses only after client approval.
- Client/subuser cannot directly set milling production statuses in any flow.
- Milling portal users can set production statuses only on assigned Design + Milling or Milling Only cases.
- Disabling a service or client flow must block new case submission, not historical status rendering or invoice math.

Use the guard inside:

- `src/app/api/cases/[id]/route.ts`
- `src/app/api/cases/[id]/milling-assign/route.ts`
- `src/app/api/milling/cases/[id]/status/route.ts`

## 11. Service Catalog Dependencies

This status work depends on the service-catalog plan landing first or in the same change set.

Required schema/data pieces:

- Add `milling_only` to `serviceTypeEnum`.
- Add `profiles.enabledServiceTypes` with new clients defaulting to `['design_only']`.
- Backfill existing clients to `['design_only', 'design_milling']`.
- Add `clientPriceList.isEnabled`.
- Seed `milling_only` service-catalog rows as inactive by default.

Required APIs:

- `GET/PUT /api/admin/clients/[id]/service-types`
- `GET /api/client/service-types`
- Existing price-list routes broadened to accept `milling_only`.

Status mapping must read `case.serviceType`; it should not infer the flow from pricing rows.

## 12. Implementation Order

| Order | Step | Why |
|---|---|---|
| 1 | Service-catalog schema/migration | `milling_only` and enabled-flow gates must exist first. |
| 2 | Add `case-status-mapping.ts` | Gives UI/API one source for labels and flow-valid statuses. |
| 3 | Update `StatusBadge` and lifecycle rendering | Admin/client labels become flow-aware. |
| 4 | Replace direct global-map usage | Avoid drift from `CLIENT_STATUS_LABELS`, `INTERNAL_STATUS_LABELS`, and `CASE_STATUS_TO_LIFECYCLE_STEP`. |
| 5 | Add transition guard | Prevent invalid statuses for each service flow. |
| 6 | Update admin/client case surfaces | Lists, detail pages, dashboard cards, filters, and notifications use mapping helpers. |
| 7 | Update milling assignment/status routes | Design + Milling assigns after `approved`; Milling Only assigns after `scan_verified`. |
| 8 | Add tests | Cover labels, lifecycle steps, skipped statuses, and invalid transitions. |

## 13. Acceptance Criteria

- Admin sees accurate operational labels for all valid statuses in all three flows.
- Client sees simplified labels and never sees milling-center identity.
- Client-facing Milling Only copy uses file/production language, not scan/design/client-approval language.
- Design Only reaches terminal success at `approved`.
- Design + Milling continues after `approved` into production and reaches terminal success at `delivered`.
- Milling Only skips designer assignment, design work, internal design QC, client design review, change request, feedback, and approval statuses.
- Lifecycle progress bars are flow-specific and do not render skipped stages.
- Client service-type choices and price-list tabs are limited to enabled flows.
- Client price-list rows hide system-disabled and client-disabled services.
- API rejects invalid status transitions for the selected service flow.
- Existing historical cases still render, even if their service or flow is later disabled.
