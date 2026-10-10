# Database migrations (dbmate)

```
npm run db:new -- <name>   # create db/migrations/<timestamp>_<name>.sql
npm run db:up              # apply all pending
npm run db:down            # roll back the LAST one (repeat for more)
npm run db:status
```
Connection comes from `DATABASE_URL` in `.env.local` (add `?sslmode=disable` for local Docker).

## Why dbmate
| Reason | Logic |
|---|---|
| **Plain SQL, owned by us** | This schema uses things an ORM cannot express: `citext`, trigram GIN indexes, partial indexes, generated columns, triggers, materialized views, `CHECK`s across columns. Writing them as SQL means what we review is exactly what runs. |
| **Real `up` AND `down`** | drizzle-kit only generates forward SQL. Each dbmate file has `-- migrate:up` / `-- migrate:down`, so a bad deploy is undone with one command, and we verify it in CI (apply all, roll back all, expect an empty schema). |
| **Independent of the app runtime** | A single static binary; no Node/ORM version coupling. The same files run from CI, Docker, or a server shell, and the Node app never needs DDL rights. |
| **Safe & ordered** | Timestamp-prefixed files apply in order, each in a transaction, tracked in `schema_migrations`. Re-running is a no-op. |
| **Drizzle stays for queries** | Drizzle is only the typed query builder. After a migration, regenerate types with `drizzle-kit pull` – SQL is the source of truth, TypeScript follows. |

## Rules for every file
1. One concern per file, named for it (`..._indexes_cases`), with a one-line purpose comment at the top.
2. `down` must exactly undo `up`, in reverse dependency order (indexes → triggers → tables/functions → types).
3. Never edit an applied migration; add a new one. In production create indexes with
   `-- migrate:up transaction:false` + `CREATE INDEX CONCURRENTLY` so writes aren't blocked.
4. Extensions are never dropped in `down` (other objects may rely on them).
5. Reference data the app depends on (status labels, role transition matrix) is seeded in a migration, not in app code.

## Order
| File | Contents |
|---|---|
| 0100 extensions_and_enums | citext, pg_trgm, all enum types |
| 0200 identity | users, profiles (`client_id` = effective lab), auth_audit_log |
| 0300 pricing | service_catalog, client_price_list, case_status_meta |
| 0400 cases | cases (narrow/hot), case_details (cold), transitions, bulk downloads, `cases_number_seq` |
| 0500 files | single R2 object registry |
| 0600 collaboration | chat, activity_logs (replaces `cases.timeline`), notifications, tickets, forms |
| 0700 billing | atomic invoice numbers, invoices, invoice_cases |
| 0800 engagement | offers, claims, tutorials |
| 0900 triggers | `updated_at`, `cases_before_write` (search_text, promoted columns, row_version) |
| 1000–1400 indexes_* | 69 indexes, grouped by domain, each tied to a query |
| 1500 rollup_views | daily analytics materialized views |
| 1600 seed_status_rules | status metadata + role transition matrix |
