# Support System: Design from Scratch

**Branch:** `support-system` (from `no-supabase-rewrite`)

**Status:** approved ("go with recommendations"). **Phases 1–2 implemented** (foundation, attachments); Phases 3–5 to do (see §17).

**Approach:** the current support feature is **replaced, not extended**:

- old tables, APIs, pages, labels and status values
- the `support_tickets`, `/api/support*`, `/api/admin/support*` routes
- the three support pages

Nothing from it is reused or kept compatible. The only bridge is a one-time import of old tickets (decision D1).

**Not rebuilt:** shared platform services the whole app depends on. These are used as building blocks only:

| Service | Code |
|---|---|
| Login sessions | `src/lib/auth/*` |
| Postgres + Drizzle, dbmate migrations | |
| Redis | `src/lib/redis.ts` |
| R2 storage + file registry | `files` table, orphan sweep, retention |
| Notification service + email queue | BullMQ + Resend |
| Activity log | |
| UI kit | `src/components/ui/*`, TanStack Query, sonner |

## Decisions carried over

| # | Decision | Choice |
|---|---|---|
| 1 | Real-time transport | SSE + Redis pub/sub |
| 2 | Statuses | Exactly 3: **New / Live / Closed** |
| 3 | Chat surfaces | Ticket page **and** floating widget, one shared conversation |
| 4 | Video | Streamed from R2 with HTTP Range requests |
| 5 | File retention | Existing R2 retention policy (3 months) |

---

## 1. Product scope

**What users get**
- **Customers** (lab owner and lab sub-users):
  - start a conversation from the Support page or the floating widget
  - chat in real time
  - send text, images, video and documents (up to 500 MB per file)
  - see when support has read their message and when an agent is typing
  - reopen a closed conversation; rate the help when it closes
- **Agents** (support staff): an inbox of all conversations.
  - Organisation: claim/assign, set priority, private internal notes, canned replies.
  - Context: see the customer's lab and recent cases; link related conversations.
  - Accountability: SLA timers and a full audit trail.
- **Everyone:** in-app notifications, plus throttled emails when you are not online.

**Out of scope (v1):** email-in replies, voice/video calls, AI replies, public help centre, multi-language.

---

## 2. Roles and permissions

| Capability | Lab owner (`client`) | Lab sub-user (`subuser`) | Agent (`admin`, `qc`, `account_manager`) | `designer` |
|---|---|---|---|---|
| Create conversation | ✓ | ✓ | ✓ (on behalf of a lab) | ✗ |
| See conversations | All of their lab | All of their lab (D2) | All (or scoped, D3) | ✗ |
| Send messages / attachments | Own lab | Own lab | ✓ | ✗ |
| Internal notes | ✗ never sees them | ✗ never sees them | ✓ | ✗ |
| Assign / priority / category | ✗ | ✗ | ✓ | ✗ |
| Close | ✓ | ✓ | ✓ | ✗ |
| Reopen | ✓ (within window) | ✓ (within window) | ✓ any time | ✗ |
| Rate (CSAT) | ✓ | ✓ | ✗ | ✗ |
| Canned replies, SLA settings | ✗ | ✗ | ✓ (settings: admin only) | ✗ |

All rules live in **one policy module** (`src/lib/support/policy.ts`). Every API calls it; nothing is checked only in the UI.

---

## 3. Core concepts

- **Conversation (ticket):** one support case with a lab, with subject, category, priority, status and assignee. Number: `SUP-000123`, from a database sequence.
- **Message:** one entry in a conversation. Three kinds:
  - `customer` / `agent`: normal chat messages
  - `note`: internal, agents only
  - `system`: automatic lines such as "Assigned to Priya" or "Conversation closed"
- **Attachment:** a file on a message. Stored in R2, registered in the `files` table.
- **Read state:** how far each person has read in a conversation. Powers read receipts and unread badges.
- **Event:** an audit row for every change (status, assignee, priority, category, reopen, rating).

---

## 4. Lifecycle

```
               agent replies / is assigned            close (anyone)
      NEW ─────────────────────────────────────►  LIVE ─────────────────►  CLOSED
       ▲                                           ▲                          │
       │                                           └── reopen ────────────────┘
   created                              (customer within window, agent any time)
```

| Status | Meaning | Set by |
|---|---|---|
| **New** | Nobody from support has picked it up | System on creation |
| **Live** | Support has engaged; conversation active | System: first agent message, assignment, or reopen |
| **Closed** | Finished | Customer, agent, or the auto-close job |

**Derived flags (not statuses), shown as small badges:**
- **Waiting on customer:** the last public message is from an agent. Pauses the SLA clock; used by auto-close.
- **Waiting on support:** the last public message is from the customer.
- **SLA at risk / breached:** see §10.

**Rules:**
- A customer message on a Closed conversation inside the **reopen window** (D4, default 14 days) reopens it to Live.
- After the window, the composer offers "Start a new conversation". The new one is linked to the old one.
- **Auto-close:** Live and "waiting on customer" for N days (D4, default 7). A system message is posted first, as a warning one day before, then the conversation closes.
- Every transition goes through one function, `transition(ticket, action, actor)`. It validates the move, writes the event and publishes the real-time update. Illegal moves are rejected.

---

## 5. Data model (new tables, dbmate migration)

**Naming:** all tables start with `sup_`, so they never clash with the old `support_*` tables during cut-over.

### `sup_tickets`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `number` | bigint | `nextval('sup_ticket_number_seq')`, shown as `SUP-000123`; unique |
| `client_id` | uuid → profiles | The lab account (owner) |
| `created_by` | uuid → profiles | Who started it (owner, sub-user or agent) |
| `subject` | varchar(200) | |
| `category` | enum `sup_category` | `technical, billing, case, account, feature_request, other` |
| `priority` | enum `sup_priority` | `low, normal, high, urgent` |
| `status` | enum `sup_status` | `new, live, closed` |
| `assignee_id` | uuid → profiles, null | |
| `source` | enum | `page, widget, agent` |
| `related_case_id` | uuid → cases, null | Optional: "this is about case X" |
| `linked_ticket_id` | uuid → sup_tickets, null | Follow-up of an old conversation |
| `last_message_at`, `last_public_sender` | timestamptz, enum `customer/agent` | Drive sorting and the waiting flags |
| `first_response_due_at`, `first_responded_at` | timestamptz | SLA |
| `closed_at`, `closed_by`, `close_reason` | | `resolved, no_reply, duplicate, spam` |
| `reopened_count` | int | |
| `csat_score` (1–5), `csat_comment`, `csat_at` | | |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:**
- `(client_id, last_message_at desc)`
- `(status, priority, last_message_at desc)`
- `(assignee_id, status)`
- `(first_response_due_at) where first_responded_at is null and status <> 'closed'`
- a full-text GIN index on subject

### `sup_messages`

| Column | Notes |
|---|---|
| `id` uuid, `ticket_id` → sup_tickets (cascade) | index `(ticket_id, seq)` |
| `seq` bigint | Per-database sequence; strictly increasing; used for ordering, SSE replay and read receipts |
| `kind` enum | `customer, agent, note, system` |
| `author_id` → profiles, null for system | |
| `body` text | ≤ 10,000 chars, plain text, always rendered escaped |
| `client_msg_id` uuid | Unique per `(ticket_id, author_id)`: sends are idempotent |
| `created_at`, `edited_at`, `deleted_at` | Edit/delete allowed for 15 min by the author (agents: notes any time) |

A GIN full-text index on body is used for agent search.

### `sup_attachments`

| Column | Notes |
|---|---|
| `id`, `message_id` (null until sent), `ticket_id` | |
| `file_id` → `files.id` | **The R2 object is registered in `files`** (new kind `support`). That keeps it safe from the orphan sweep, and retention marks it purged automatically. |
| `kind` enum | `image, video, document` |
| `width`, `height`, `duration_sec`, `thumbnail_file_id` | Optional metadata (phase 5) |

`files` gets one new enum value (`support`) and one nullable column `support_ticket_id`. That is the only change to a shared table.

### `sup_reads`

`(ticket_id, user_id)` PK, `last_read_seq`, `updated_at`.

### `sup_events` (audit)

`id, ticket_id, actor_id (null = system), type, from_value, to_value, created_at`.

Types: `created, status, assignee, priority, category, reopened, linked, rated, auto_closed`. Also mirrored to the activity log.

### `sup_canned_replies`

`id, title, body, shortcut, owner_id (null = shared), updated_at`

### `sup_sla_policies`

One row per priority: `first_response_minutes`, `next_response_minutes`, `business_hours bool` (D5).

---

## 6. Code layout

```
src/lib/support/
  policy.ts          who can do what (pure functions, unit-tested)
  lifecycle.ts       transition(): status rules, events, real-time publish
  service.ts         create ticket, send message, read, assign, rate — the only DB writers
  queries.ts         list/inbox/thread reads; strips internal notes for customers at query level
  validation.ts      boundary schemas for every request (zod — new small dependency, D7)
  realtime.ts        Redis publish + one shared subscriber per process; SSE helpers
  attachments.ts     upload policy (types, sizes, names), signed URLs
  sla.ts             due-time calculation (24/7 or business hours)
  notify.ts          in-app + throttled email via the existing NotificationService
  jobs.ts            auto-close, SLA warnings (run by the existing worker)

src/app/api/support/...        thin route handlers: auth → validate → service → JSON
src/components/support/...     UI (§9)
```

**Rule:** routes never touch tables directly. They call `service` / `queries`, which always go through `policy`.

---

## 7. API

One resource API for customers and agents; the policy decides what each caller may see and do. All bodies are JSON, all inputs are validated, and errors use the shape `{ error, code }`.

| Method & path | Who | Purpose |
|---|---|---|
| `GET /api/support/tickets?status=&scope=mine\|unassigned\|all&q=&cursor=` | all | List (customers: their lab; agents: inbox views). Cursor paging. |
| `POST /api/support/tickets` | customer, agent | Create with first message (+ attachment ids) |
| `GET /api/support/tickets/:id` | all | Ticket + participants + read states |
| `GET /api/support/tickets/:id/messages?before=&after=` | all | Paged thread; notes only for agents |
| `POST /api/support/tickets/:id/messages` | all | Send (`client_msg_id` makes it idempotent); `kind: note` agents only |
| `PATCH /api/support/tickets/:id/messages/:msgId` | author | Edit / delete within window |
| `POST /api/support/tickets/:id/read` | all | Mark read up to `seq` |
| `POST /api/support/tickets/:id/typing` | all | Typing ping (Redis only, rate-limited) |
| `POST /api/support/tickets/:id/actions` | per policy | `{ action: close \| reopen \| assign \| claim \| set_priority \| set_category \| link }` |
| `POST /api/support/tickets/:id/rating` | customer | CSAT once, after close |
| `POST /api/support/uploads` | all | `init` / `sign` / `complete` / `abort` (multipart, §8) |
| `GET /api/support/attachments/:id` | all | Ownership check → short-lived signed R2 URL (302) |
| `GET /api/support/stream` | all | SSE (§11) |
| `GET /api/support/summary` | all | Unread count, new count for badges/widget |
| `GET/POST/PATCH/DELETE /api/support/canned-replies` | agent | Canned replies |
| `GET/PUT /api/support/settings/sla` | admin | SLA policy |
| `GET /api/support/customers/:clientId/context` | agent | Lab info, recent cases, past conversations |

**Rate limits** (existing Redis limiter, per user):

| Action | Limit |
|---|---|
| Create ticket | 10 / hour |
| Messages | 30 / minute |
| Uploads | 20 / hour |
| Typing | 1 / 2 s |

---

## 8. Attachments (up to 500 MB, never through our server)

1. **`init`:** the server checks:
   - the caller may post in this ticket
   - size ≤ 500 MB
   - an allowed type and extension
   - a safe file name

   Then it creates a `files` row (`kind = support`, `status = pending`, `support_ticket_id`) and an R2 multipart upload at `support/{ticketId}/{uploadId}/{safeName}`.
2. **`sign`:** presigned part URLs (64 MB parts, the same uploader as case files).
3. The browser uploads parts directly to R2, with progress, retry per part and cancel.
4. **`complete`:** the server completes the upload, then **checks the real object** (size, content type). If it doesn't match the policy, the object is deleted and the row marked failed. Otherwise the row is marked `ready` and a `sup_attachments` row is created.
5. The message is sent with the attachment ids; they are bound to the message in the same transaction.

**Rules:**
- Allowed:
  - images: jpg, png, webp, gif, heic
  - video: mp4, mov, webm
  - documents: pdf, txt, csv, docx, xlsx
- Executables and scripts are always blocked.
- Max 10 files per message.
- An attachment can only be bound to a message in the same ticket by the same uploader.

**Viewing:**
- Images and video are served through `GET /api/support/attachments/:id`, which redirects to a 15-minute signed R2 URL.
- The `<video>` tag streams with Range requests (seek without downloading). The player re-requests the URL if it expires.
- Codecs the browser can't play show a download button.

**Retention:** files older than 3 months are deleted by the existing policy, and their `files` row becomes `purged`. The UI shows "File removed after 3 months", while the message text stays. The composer states the retention period.

**Abandoned uploads:** see decision D6.

---

## 9. User interface

### Customer

| Surface | What it is |
|---|---|
| **Support page** `/client/support` | Two panes. Left: list of conversations (status, unread dot, last message). Right: the thread. "New conversation" button. Mobile: list → thread. |
| **Thread** | Header: number, subject, status, assignee, "usually replies in …". Chat bubbles with grouped messages, timestamps, delivery and read ticks, typing indicator. System lines centred. Image grid and video player inline. |
| **Composer** | Multi-line text (Enter = send, Shift+Enter = new line), attach / drag / paste, per-file progress with cancel/retry, the 500 MB and 3-month notes. |
| **Closed state** | Banner with Reopen (inside window) or "Start a new conversation"; CSAT card (1–5 + comment). |
| **Floating widget** | Bottom-right button with unread badge on every lab page. Opens a compact panel with the same list and thread components. Starting there sets `source = widget`. |

### Agent workspace `/support` (staff)

| Area | What it holds |
|---|---|
| **Inbox** | Views: Unassigned · Mine · All · Closed. Filters: priority, category, lab, SLA at risk/breached. Search (subject + messages). Sorted by SLA due, then last activity. |
| **Thread** | Same thread component, plus internal notes (yellow, "Only visible to staff"), canned replies on `/`, assign/claim, priority/category, close/reopen, link conversation. |
| **Customer panel** | Lab name, owner, plan, contact, recent cases (link), previous conversations, CSAT history. |
| **Settings** | Canned replies; SLA targets (admin). |

### Shared

- Accessible: keyboard navigation, focus states, ARIA live region for new messages, reduced motion.
- Loading, empty, error, offline ("Reconnecting…") and permission-denied states for every view.
- Components in `src/components/support/`:
  - `TicketList`, `Thread`, `MessageBubble`, `Composer`, `AttachmentTile`, `VideoPlayer`
  - `SupportWidget`, `AgentInbox`, `CustomerPanel`, `CsatCard`
  - hooks `useSupportStream`, `useThread`, `useUploads`

---

## 10. SLA, notifications, CSAT

**SLA**
- **First response due** = created + `first_response_minutes`.
- **Next response due** = last customer message + `next_response_minutes` (Live, waiting on support).
- The clock is paused while waiting on the customer.
- Defaults:

  | Priority | First response | Next response |
  |---|---|---|
  | urgent | 1 h | 2 h |
  | high | 4 h | 8 h |
  | normal | 8 h | 24 h |
  | low | 24 h | 48 h |

- Alerts at 80 % and at breach go to the assignee, or to all agents if unassigned (in-app).

**Notifications** (existing service):

| Event | Who is notified |
|---|---|
| New conversation | All agents |
| Customer message | Assignee (or all agents if unassigned) |
| Agent reply | Lab owner + the sub-user who created it |
| Assignment | The new assignee |
| Closed / reopened | The other side |

- **Email:** only if the person has no open SSE connection. One email per conversation per 10 minutes, summarising the unread messages.
- **CSAT:** asked once on close; the score is stored on the ticket and in events. Agents see averages in the inbox header.

---

## 11. Real-time (SSE + Redis)

```
browser ──POST message──► web #1 ──► Postgres (source of truth, seq assigned)
                                └──► PUBLISH sup:ticket:{id} / sup:client:{clientId} / sup:agents
browser ◄──SSE /api/support/stream── web #2 ◄── one Redis SUBSCRIBE connection per process
```

- **One stream per browser tab.** The server subscribes it to the channels the policy allows:
  - customers: their lab
  - agents: agent inbox + open threads
- **Events:**
  - `message.created`, `message.updated`
  - `ticket.updated` (status, assignee, priority)
  - `read.updated`, `typing`, `presence`
  - `summary.updated` (badge counts)
- **Internal notes** are published only on agent channels.
- **Replay:** every message event carries `id: <seq>`. On reconnect the browser sends `Last-Event-ID`, and the server sends the missed messages from Postgres before going live. If streaming is blocked, the client falls back to polling every 30 s.
- **Keep-alive and limits:**
  - a heartbeat every 25 s
  - the `X-Accel-Buffering: no` header (nginx)
  - max 5 streams per user
  - the session is re-checked every 5 minutes; the stream closes when the session ends
- **Redis connections:** a dedicated subscriber connection per process (the shared client can't subscribe). Publishing uses the shared client.
- **Presence / typing:** short-lived Redis keys. They are never stored in Postgres.
- **Losing Redis** never loses data: clients refetch on reconnect.

---

## 12. Security

- **Authorization:** one policy module. Every query is scoped by the caller's lab (customers) or role (agents).
- **Tests:** customer A cannot read, post to, upload to, or subscribe to lab B's tickets.
- **Internal notes:** filtered in `queries.ts`, not only in the UI. They are never published on customer channels or included in customer notifications or emails.
- **Input:**
  - Validated at every boundary: length, enums, UUIDs, MIME types, sizes.
  - Message text is plain and escaped on render (no HTML, no markdown in v1).
  - Links are auto-detected and rendered with `rel="noopener noreferrer"`.
- **Uploads:**
  - The server verifies size and type after upload.
  - Keys are generated by the server; executables are blocked.
  - Private bucket only; access by short-lived signed URL after an ownership check.
- **Abuse:** rate limits (§7), a stream limit, a callback-style spam guard on ticket creation.
- **Audit:** every change is recorded in `sup_events` and the activity log. Secrets and message bodies are never written to logs.

---

## 13. Background jobs (existing worker process)

| Job | Every | Does |
|---|---|---|
| `support:sla` | 1 min | Due-time warnings and breaches; marks alerts sent |
| `support:auto-close` | 15 min | Warn after N−1 days of no reply, close after N days |
| `support:email-digest` | 1 min | Sends throttled unread summaries |
| `support:upload-reaper` | 1 h | Aborts multipart uploads still pending after 24 h (D6) |

---

## 14. Cut-over from the old system

1. Ship the new system behind the new routes and pages (old ones untouched while building).
2. **Import:** (D1) copy old tickets into `sup_tickets`, keeping their id. Open tickets stay New, in-progress ones become Live, resolved/closed become Closed (so nobody's active ticket is silently closed). Old callback requests become closed "callback" conversations:
   - the old `message` becomes the first customer message
   - old `admin_notes` become an internal note
   - the numbers keep their old text in a `legacy_number` column
   - priorities map as `critical → urgent` and `medium → normal`; categories map one-to-one, with `case_issue → case` and `account_access → account`
3. Switch the sidebars to the new pages; delete the old pages, APIs, `support-tickets.ts` and the old notification types.
4. A later migration drops `support_tickets` (after a backup), and keeps or rebuilds the callback-request feature (D8).

---

## 15. Delivery phases

Each phase is shippable and tested.

| Phase | Delivers |
|---|---|
| **1. Foundation** | Migration, policy, lifecycle, service/queries, ticket + message APIs, customer page and agent inbox with polling, import of old tickets |
| **2. Attachments** | Upload flow, image previews, video streaming, purged state, upload reaper |
| **3. Live** | SSE + Redis, typing, presence, read receipts, live badges, floating widget |
| **4. Agent tools** | Assignment views, internal notes, canned replies, customer panel, search, linking |
| **5. SLA & polish** | SLA timers and alerts, email digests, auto-close, CSAT, metrics |

**Verification per phase:**
- **Unit:** policy, lifecycle transitions, SLA math, validation.
- **Integration:** idempotent sends, cross-lab isolation, notes never reaching customers, SSE across two web processes.
- **Manual:** 500 MB upload on a throttled network, video seek, widget ↔ page sync, reconnect replay, purged file.
- **Standard:** lint, type check, vitest, build.

---

## 16. Decisions needed before Phase 1

| # | Question | Recommendation |
|---|---|---|
| D1 | Import old tickets as closed history, or start empty? | Import (keeps lab history) |
| D2 | Can sub-users see all of their lab's conversations, or only their own? | All of their lab |
| D3 | Account managers: all conversations, or only labs they manage? (no lab↔manager link exists; would need one) | All |
| D4 | Reopen window / auto-close after no reply | 14 days / 7 days |
| D5 | SLA clock: 24/7 or business hours (which timezone, days, hours)? | Business hours, if you give the hours |
| D6 | Abandoned uploads: Cloudflare R2 lifecycle rule (one-time setting) or the `upload-reaper` job? | The job (no manual setup) |
| D7 | Add `zod` for request validation? | Yes |
| D8 | Keep "Request a callback"? | Yes, as a button in the widget that creates a conversation with category "callback" |
| D9 | Who may create conversations on behalf of a lab — all agents or admins only? | All agents |
| D10 | Designers: no access at all? | No access |

---

## 17. Implementation status

**Decisions:** all recommendations accepted. **D5:** no business hours were given, so the SLA clock will run 24/7 until they are set (SLA is Phase 5).

### Phase 1 — Foundation (done)

**Migration:** `db/migrations/20261122000100_support_system.sql`
- Creates the enums, the ticket/message sequences, `sup_tickets`, `sup_messages`, `sup_reads` and `sup_events`.
- Imports old tickets and callbacks.
- Tested locally: apply, rollback, re-apply, and the import mapping.

**Domain code:** `src/lib/support/`

| File | Role |
|---|---|
| `constants` | Shared vocabulary |
| `types` | Shared shapes |
| `policy` | Who may do what |
| `lifecycle` | Status rules |
| `validation` | zod schemas |
| `http` | Auth, errors, rate limits |
| `queries` | Read side; notes filtered here |
| `service` | Write side; locked transactions and audit |
| `notify` | Notifications |

**API:** `src/app/api/support/`

| Endpoint | Purpose |
|---|---|
| `tickets` | List / create |
| `tickets/[id]` | Ticket header |
| `tickets/[id]/messages` | Read / send |
| `tickets/[id]/read` | Mark read |
| `tickets/[id]/actions` | Close, reopen, assign, triage |
| `summary` | Badge counts |
| `agents` | Assignment menu |

**UI:** `src/components/support/`. It is used by:
- `/client/support` (labs)
- `/support` (QC, account managers)
- `/admin/support` (admins)

Lists and threads refresh by polling (thread 8 s, list 30 s) until Phase 3 adds the live stream.

**Changes elsewhere in the app:**
- **Sidebar badges:** use the new summary.
- **Designers:** have no support access (routing rules and sidebar).
- **Client deletion:** removes `sup_tickets`.
- **New notification type `support_message`:** in-app only (no email per message).

**Removed:**
- The old support API routes
- `src/lib/support-tickets.ts`
- The old support notification helpers

The old tables and their Drizzle schema files remain until the drop migration.

**Tests:**
- `src/lib/__tests__/support-rules.test.ts`: 15 unit tests (policy, lifecycle, validation).
- `src/lib/__tests__/support-db.integration.test.ts`: 8 tests against a real database (lab isolation, idempotent sends, notes hidden, reopen window, assignment, search and paging).
  - Off by default; run with `SUPPORT_DB_TEST=1 DATABASE_URL=<local db>`.
- Also verified end-to-end in a browser (two users, desktop and mobile).

**Deploy notes:**
- Run the migration with `npm run db:deploy`.
- `npm install` adds `zod` (already present as a dependency of another package).

**Testing note:** the dev server runs the email worker. With a live `RESEND_API_KEY` in `.env`, any local test that creates conversations emails every active agent. Remove the key (or disable agents' email preferences) before manual testing.

### Phase 2 — Attachments (done)

**Migration:** `db/migrations/20261122000200_support_attachments.sql`
- Adds the `support` value to `file_kind`, `files.support_ticket_id` and `sup_attachments`.
- Tested locally: apply, rollback, re-apply.

**Flow:** `src/lib/support/attachments.ts` and `POST /api/support/uploads` (actions `init`, `sign`, `complete`, `abort`).
1. The browser uploads 64 MB parts straight to R2, 3 at a time, retrying each part.
2. On `complete`, the server checks the stored object's real size; a mismatch is deleted and marked failed.

**Rules:** `src/lib/support/upload-policy.ts`, shared by browser and server.
- Allowed: images, videos, PDFs, text, CSV, Office files and ZIP.
- The server decides the served content type from the extension; SVG, HTML and scripts are not allowed.
- Limits: 500 MB per file, 10 files per message.

**Storage keys:** `support/<lab>/<ticket|new>/<upload id>/<safe name>`. Each object is registered in `files` (kind `support`), so the orphan sweep keeps it and retention marks it purged.

**Sending:**
- Attachments are bound inside the send transaction, and only:
  - your own finished, unsent uploads
  - for this conversation, or for this lab's new conversation
- A message can be attachments only.
- Labs can attach files to their first message (new-conversation dialog).

**Viewing:** `GET /api/support/attachments/:id` checks access, then redirects to a 15-minute signed R2 URL (`?download=1` to download).
- Video streams with Range requests; the player gets a fresh link if one expires mid-playback.
- Images and videos that can't be shown fall back to a download tile.
- Files on internal notes are never served to labs.
- Retention-purged files return 410 and show "Removed after 3 months".

**UI:**
- Attach button, drag and drop onto the thread, paste screenshots.
- Upload tiles with progress, cancel and retry.
- Image grid, video player, document tiles.

**Cleanup:**
- Maintenance job `support-upload-reaper` runs hourly and removes uploads never sent within 24 h (D6).
- Client deletion also removes a lab's unsent uploads.

**Tests:**
- `support-upload-policy.test.ts`: 7 unit tests.
- `support-attachments.integration.test.ts`: 8 tests against a real database with in-memory fake storage. They cover:
  - uploads, parts and size verification
  - who may send which upload
  - files on notes hidden from labs
  - expired files, cancelling and the reaper
- Browser: attachment display and the composer, checked on seeded data.

**Not tested:** a real browser upload into R2. The local `.env` bucket (`clipforge`) is the app's real bucket, so this needs a dev bucket or your go-ahead.

**R2 CORS:** browser part uploads need the bucket to allow the app origin and expose `ETag`. Case uploads already depend on this, so production should be set up.

**Testing note:** the dev server refuses to start without `RESEND_API_KEY`. Use a fake value (e.g. `RESEND_API_KEY=re_local_test_disabled npm run dev`): Resend rejects every send and nothing is delivered.
