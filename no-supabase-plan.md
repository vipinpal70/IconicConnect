# Remove Supabase — phased plan (branch `no-supabase-rewrite`)

Decisions: auth + DB live inside this Next.js app (Drizzle + postgres-js, local/self-hosted PG16 + Redis 7);
auth.users bcrypt hashes are migrated and re-hashed to argon2id on first login. Schema target: supabase/migrations/# IconicConnect — Upgraded Database Sche.md.

## Phase 1 — foundations (DONE, additive, nothing wired yet)
- src/lib/auth/password-hash.ts  argon2id + legacy bcrypt verify, timing-safe for unknown emails
- src/lib/auth/session.ts        Redis sessions, 1 GET/request, 7 h absolute, revoke-all per user
- src/lib/security/rate-limit.ts sliding-window counter (Lua, 1 round trip), escalating IP ban, login-failure lockout (email + IP), more per-route budgets

## Phase 2 — schema (DONE: dbmate migrations in db/migrations, see db/README.md)
- Drizzle migrations for users table (id = old auth.users.id so FKs survive), profiles.client_id, citext/pg_trgm, timestamptz, files registry, invoice_cases, indexes (§4-§5 of design doc).
- Keep old tables until Phase 5 so master keeps running on the same DB if needed (dual-schema via new migration numbers 0060+).

## Phase 3 — wire auth (DONE)
- New /api/sign-in, sign-out, forgot/reset-password, sign-up, admin user create/credentials (replace supabase.auth.admin.*).
- proxy.ts: cookie -> getSession() -> inject x-iconic-uid/role/client-id headers. Delete gateCache/userCache/login-stamp.
- request-user.ts / resolve-client-id.ts read session headers (no DB). Remove supabase/{client,server,admin}.ts.
- Sidebars / pages that call supabase.* client-side -> fetch('/api/...').

## Phase 4 — queries + Redis cache (DONE: Drizzle ported, files registry, activity_logs timeline, invoice_cases, sparse prefs, epoch-versioned cache)
- Replace supabase.from(...) in ~112 files with Drizzle repositories (one API route per UI section — see memory).
- Cache epochs (`ver:client:{id}`) per design §7; mv rollups for analytics.

## Phase 5 — data migration + cutover
- scripts/migrate-from-supabase.ts: public.* + auth.users(id,email,encrypted_password) -> new schema; row-count verification.
- Remove @supabase/* deps, env vars, supabase/ dir.

Risks: Supabase-only features in use (RPC get_case_price, PostgREST lockdown migration 0056) must be ported; `consultant` role removal needs a data check first.
