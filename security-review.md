# IconicConnect — Security Review

## Remediation status (second pass)

| ID | Issue | Status | Where |
|---|---|---|---|
| C1 | Public admin creation | **Fixed** — requires active admin session or server-only `ADMIN_SIGNUP_SECRET` (timing-safe, fails closed); password logging removed; setup key now typed into the form, not bundled | `api/admin/user`, `admin/sign-up/page.tsx` |
| C2 | RLS / PostgREST open to all users, self-promotion via profile UPDATE | **Fixed in code, migration must be run** | `0056_lock_down_postgrest_access.sql`, `api/profile/[id]` now uses Drizzle |
| C3 | Next.js proxy-bypass advisory | **Fixed** — `next` 16.3.8; `npm audit --omit=dev` = 0 vulnerabilities | `package.json` |
| H1 | `/api/sign-up` trusted `body.id` | **Fixed** — id/email verified against Auth user, must be new + profile-less, only deletes what it created; email HTML escaped; lab-name uniqueness enforced | `api/sign-up` |
| H2 | Uploaded HTML served on app origin | **Fixed** — forced download + `nosniff`; HTML only inside `CSP: sandbox allow-scripts` (opaque origin); iframe sandboxed | `api/cases/files`, `CaseDetailView` |
| H3 | Weak / spoofable rate limiting | **Fixed** — Redis-backed, real client IP, per-endpoint budgets | `proxy.ts`, `lib/security/rate-limit.ts` |
| H4 | Enumeration, plaintext passwords, weak policy | **Fixed** — neutral forgot-password reply; credential emails carry a set-password link instead of a password; policy ≥10 chars/3 classes; random subuser passwords; plaintext `profiles.password` no longer stored/returned and wiped by the migration | many (see diff) |
| H5 | Milling partners could read any case | **Fixed** (later made moot: the milling portal was removed in design-only-removal-plan.md) — path allow-list in proxy + assignment check in handlers; client timeline filtered server-side | `proxy.ts`, `lib/case-access.ts` |
| M1 | Shared lab-name storage folders | **Partly fixed** — new sign-ups must have a unique name; existing duplicates and the `labName/fileName` key scheme still need a data migration (see below) | `api/sign-up` |
| M2 | Unvalidated file URLs / SSRF | **Fixed** — only our proxy URL for the right lab, or our Supabase host; bulk-download no longer fetches arbitrary URLs | `lib/security/safe-url.ts` + callers |
| M3 | Upload endpoints not scoped | **Fixed** — keys bound to caller's lab/staging prefix, URL must match key, file names validated | `api/cases/upload`, `bulk/*` |
| M4 | No security headers | **Fixed** — HSTS, nosniff, frame, referrer, permissions, COOP, safe CSP subset; nginx `server_tokens off` + streaming block | `next.config.js`, `nginx/` |
| M5 | Tokens in sign-in response / JS cookie | **Fixed** | `api/sign-in`, `auth/sign-in/page.tsx` |
| M6 | `db-status` leak | **Fixed** — route removed | |
| M7 | OTP activation attempts | **Fixed** — per-IP limit | `proxy.ts` |
| M8 | Dependencies | **Fixed** for production deps (dev-only advisories remain) | |
| M9 | Sensitive logs | **Fixed** (member list / emails / bodies) | |
| New | Tutorials/offers create/delete open to every internal role | **Fixed** — admin only | `api/tutorials`, `api/offers` |
| New | Case timeline leaked internal events to clients | **Fixed** | `lib/case-access.ts` |
| New | CSRF | **Added** Origin check on state-changing `/api` calls | `proxy.ts` |

### Actions only you can do (not code)
1. **Run migration 0056 on staging first** (`npm run db:migrate`), then production. Confirm `DATABASE_URL` connects as `postgres`/an owner role (bypasses RLS), otherwise the app would be blocked. Afterwards test with a client JWT against `/rest/v1/cases`, `/rest/v1/profiles?select=*` (should return only own profile or nothing) and a `PATCH` on `profiles` (must fail).
2. **Rotate `ADMIN_SIGNUP_SECRET`**, set it only as a server env var, delete `NEXT_PUBLIC_ADMIN_SIGNUP_SECRET`. The old value was shipped to every browser. **Audit existing admins:** `select email, created_at from profiles where user_role='admin' order by created_at;` and look in Supabase Auth for unknown users.
3. **Supabase Auth settings:** password minimum 10 + required character classes, leaked-password protection, email confirmation, short OTP/recovery expiry. Sign-up happens via the browser SDK so these server settings are the only enforcement there.
4. **Force password resets for every sub-user** — their plaintext passwords were stored and shown in the UI until now.
5. **Deploy nginx changes** (`nginx -t && systemctl reload nginx`) and confirm Cloudflare/real-IP headers still arrive.
6. **Redis:** require a password / bind to localhost; rate limits, caches and bulk-download slots live there.
7. **Supabase Storage bucket `case-files` is public** (legacy uploads use `getPublicUrl`). Moving those routes to R2/signed URLs is a follow-up; until then anyone with a URL can read those files.
8. **R2 key scheme** `labName/fileName` still lets two cases with the same file name overwrite each other and, for any pre-existing duplicate lab names, share a folder. Plan a re-key to `clientId/caseId/uuid-name` with a copy+backfill migration.
9. **Enable MFA** for admin accounts; review Cloudflare WAF rules for `/api/sign-in`, `/api/sign-up`, `/api/auth/*`.

### Not covered
I read every route's auth guard and the sensitive handlers in full, but did not read every line of the ~115 handlers or the front-end, did not test against live Supabase/R2/nginx, and did not review infrastructure (server hardening, backups, secrets storage, CI).

---

**Scope and method:** static review of the repo (auth proxy, all 114 API route files scanned for auth guards, the sensitive routes read in full, DB migrations/RLS, R2/file handling, config, `npm audit`). I did **not** read every line of every route and did **not** test against the live Supabase, R2 or nginx. Items marked *(verify live)* depend on production settings.

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

## 🔴 Critical

### C1. Anyone can create an admin account — `POST /api/admin/user`
`src/app/api/admin/user/route.ts` is whitelisted as a public API in `src/proxy.ts` and uses the service-role key. The secret check is:
```ts
if (adminSecret && adminSecret !== process.env.ADMIN_SIGNUP_SECRET) → 401
```
If the `x-admin-secret` header is **omitted**, the check is skipped. An unauthenticated request with `{email, password}` creates an active, email-confirmed **admin** (full platform takeover).
Also: `console.log(body)` writes the plaintext password to logs; and `src/app/admin/sign-up/page.tsx` sends `NEXT_PUBLIC_ADMIN_SIGNUP_SECRET`, which is **shipped in the browser bundle**, so the "secret" is public.
**Fix:** require the secret (fail closed when missing or env unset), move it server-side only, ideally remove the route and create admins by script or from an existing admin session; remove `console.log(body)`; rotate the secret.

### C2. Row-level security lets any logged-in user read/write every tenant's data *(verify live)*
`0040_enable_rls_and_policies.sql`: `cases`, `case_files`, `case_messages`, `activity_logs`, `invoices`, `client_price_list`, `support_tickets`, `chat_messages`… all use `FOR ALL … USING (is_active_user())`, and `profiles` is selectable by any active user. The anon key is public by design, so any active client can call Supabase PostgREST directly with their JWT and read other labs' cases, invoices, prices, emails and phone numbers, or **update** rows (status, prices, invoices). The server uses Drizzle directly (bypasses RLS), so the app works while the hole stays open.
**Fix:** per-tenant policies (`client_id = auth.uid()` or parent client, role-scoped for staff), or revoke `anon`/`authenticated` table grants and expose nothing through PostgREST (the app doesn't use it for data). Test with a client JWT against `/rest/v1/cases`.

### C3. Next.js has a critical advisory that bypasses `proxy.ts`
`npm audit`: `next` ≤ 16.3.5 — "Middleware / Proxy bypass in App Router applications using Turbopack" (this project sets `turbopack: {}`), plus a Server Actions DoS. Installed: 16.2.6. Your role-based path protection lives in `src/proxy.ts`, so a bypass defeats it for any route that relies on it.
**Fix:** upgrade `next` to a patched version now; confirm the build config isn't affected.

---

## 🟠 High

### H1. `POST /api/sign-up` can delete other users' auth accounts and spam email
- Public route trusts `body.id`. On any failure (including duplicate primary key) it runs `supabaseAdmin.auth.admin.deleteUser(body.id)`. Posting an existing user's UUID makes the profile insert fail with `23505`, and the **victim's auth user is deleted**. UUIDs are exposed in many API responses.
- It never checks that `body.id` is a freshly created auth user that matches `body.email`.
- `body.fullName` and `body.email` go unescaped into a welcome email, so it can be used to send attacker-controlled HTML to arbitrary addresses.
**Fix:** create the Supabase user server-side in this route (or verify the id/email with the service client and require `created_at` within seconds and no profile); only delete users this request created; HTML-escape and rate-limit.

### H2. Uploaded HTML is served inline from the app origin (stored XSS)
`/api/cases/files` returns `.html/.htm` as `text/html` with `Content-Disposition: inline` on the main origin. Clients can upload `.html` (it is not in `BLOCKED_EXTENSIONS`). A staff member opening the link runs attacker script with their session (admin takeover).
**Fix:** serve user files as `attachment` with `X-Content-Type-Options: nosniff`; if HTML previews are needed, use a separate sandbox domain or `Content-Security-Policy: sandbox` and `<iframe sandbox>`; also block `.svg`/`.html` from untrusted uploaders.

### H3. Rate limiting is weak and spoofable
`src/proxy.ts`: in-memory `Map` (per process, unbounded growth), 300 req/min, and the key uses the **first** `X-Forwarded-For` value, which a client controls (nginx appends to the incoming header). Login, forgot-password and OTP endpoints have no dedicated limits.
**Fix:** use `CF-Connecting-IP`/`X-Real-IP`, a Redis-backed limiter, and tight per-route limits (sign-in, forgot-password, sign-up, activate).

### H4. Account/email enumeration and plaintext credentials
- `forgot-password` returns 404 "User with this email does not exist".
- New-member and credential-reset emails contain the **plaintext password** (`admin/members/route.ts`, `*/credentials/route.ts`).
- Password policy is a 6-character minimum.
**Fix:** neutral response; send set-password/invite links; raise the minimum and check breached lists.

### H5. Milling-portal users can reach case APIs
> Historical finding — the milling portal and `milling_*` roles have since been removed from the app.

`proxy.ts` allows `/api/cases/*` for every authenticated role. `GET /api/cases/[id]` and `/activity` only restrict `client`/`subuser`, so `milling_*` accounts (third-party partners) can read **any** case, including lab data. Staff roles also reach `/api/cases/files` DELETE for any lab file.
**Fix:** enforce an assignment check for milling roles in these handlers and limit file deletion to the owning lab or admin.

---

## 🟡 Medium

- **M1. Same lab name shares storage.** R2 key is `labName/fileName` and `labName` is not unique (falls back to full name or email). Two clients with the same name can read or overwrite each other's files, and two cases with the same file name overwrite each other. Use an immutable id-based key (`clientId/caseId/uuid-name`).
- **M2. Unvalidated file URLs.** `POST /api/cases` stores client-supplied `fileUrl` values (`uploadedFiles`, `referenceImages`, hold images). They are rendered in links/iframes (`javascript:` risk) and, in my new bulk download, fetched server-side when they are absolute URLs (**SSRF**, blind). Only accept proxy URLs or your storage host, and validate `labName` against the case owner.
- **M3. Upload endpoints don't scope the key.** `/api/cases/upload` `sign`/`complete`/`abort` accept any `key`/`uploadId` and a client-chosen `labName` for the stored URL. Bind the upload to the caller (store `uploadId → user` in Redis).
- **M4. No security headers.** No CSP, HSTS, `X-Frame-Options`, `nosniff`, or `Referrer-Policy` in `next.config.js` or nginx.
- **M5. Session tokens in the sign-in response body.** `/api/sign-in` returns the full `session` JSON; the cookie already carries it.
- **M6. `GET /api/admin/db-status`** is reachable by any authenticated admin-prefixed user and prints part of `DATABASE_URL`; remove it.
- **M7. Public `/api/admin/activate`** relies solely on Supabase OTP limits; add your own attempt limit.
- **M8. Many deps flagged:** `postcss`, `sharp` (libvips CVEs), `nanoid` (see `npm audit`).
- **M9. Sensitive data in logs:** member list, request bodies. Audit `console.log` use.

## 🟢 Low / hardening
- Admin/staff accounts have no MFA; consider enforcing it for `admin`.
- The `proxy.ts` hits the DB for every request (perf + failure mode: DB down = everyone blocked, fine, but add short cache).
- CSRF relies on SameSite cookies; add an `Origin` check on state-changing routes (the new download route accepts a form POST).
- Auth-user cleanup paths and `service_role` use are scattered (`@supabase/supabase-js` created in several routes): centralise via `src/lib/supabase/admin.ts`.
- R2 bucket: confirm it is private (no public domain) and the access key is least-privilege.

---

## What looks good
- Drizzle ORM is used throughout (parameterised queries); `sql.raw` uses code-derived values only.
- `auth.getUser()` (server-verified) rather than `getSession()`.
- Proxy enforces active-account status and role-based path prefixes; per-route ownership checks exist on `/api/cases/[id]*` for clients/subusers.
- Admin route group checks roles in nearly every handler; `.env` files are not tracked; no `dangerouslySetInnerHTML`.
- Blocked executable extensions and size limits on uploads; presigned multipart uploads keep large files off the server.

## Suggested order of work
1. **Today:** C1 (lock or remove `/api/admin/user`, rotate secret, delete `console.log(body)`), C3 (upgrade Next).
2. **This week:** C2 (RLS or revoke grants, test with a client JWT), H1, H2.
3. **Next:** H3–H5, then M1–M4 (R2 key scheme is the largest change; plan a migration).
