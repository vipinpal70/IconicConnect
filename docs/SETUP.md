# IconicConnect — local setup runbook (Postgres + Redis + data move + run)

Every command below was run against this repo. Steps marked **(untested here)** are standard OS commands I could not execute on this machine.
Already have the Docker containers from earlier? Skip to **Step 3**.

```
Next.js app ──▶ PostgreSQL 16  (localhost:5433)   cases, users, files registry …
            ──▶ Redis 7        (localhost:6380)   sessions, rate limits, caches, job queues
            ──▶ Cloudflare R2                     uploaded files + database backups
```

## 0. Prerequisites
```bash
node -v        # v22.x  (use nvm: nvm install 22)
git --version
docker --version && docker compose version    # only if you choose the Docker route (recommended)
```
**Install Docker on Ubuntu/Debian** (official repo):
```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"      # then log out and back in
docker run --rm hello-world
```

## 1. Get the code and dependencies
```bash
git clone git@github.com:vipinpal70/IconicConnect.git && cd IconicConnect
git checkout no-supabase-rewrite
npm ci                               # also installs dbmate (the migration tool) into node_modules
```

## 2. Start PostgreSQL + Redis
### Option A — Docker (recommended)
```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps          # both must say "healthy"
```
Ports are bound to `127.0.0.1` only. Defaults: Postgres `postgres:postgres@localhost:5433/iconic_connect`, Redis `localhost:6380`.
Useful: `… down` (stop, keep data) · `… down -v` (stop **and delete** data) · `… --profile tools up -d adminer` (DB UI at http://localhost:8081).

### Option B — install natively on Ubuntu (untested here)
```bash
sudo apt-get install -y postgresql-16 postgresql-contrib redis-server
sudo -u postgres psql -c "CREATE USER iconic WITH PASSWORD 'choose-a-password';" \
                      -c "CREATE DATABASE iconic_connect OWNER iconic;"
# Redis: never evict sessions/queues, persist to disk
sudo sed -i 's/^# *maxmemory-policy.*/maxmemory-policy noeviction/; s/^appendonly no/appendonly yes/' /etc/redis/redis.conf
sudo systemctl enable --now postgresql redis-server && sudo systemctl restart redis-server
```
Then your URLs are `postgresql://iconic:choose-a-password@localhost:5432/iconic_connect?sslmode=disable` and `redis://localhost:6379`.

## 3. Configure `.env`
```bash
cp .env.example .env
openssl rand -hex 32     # → ADMIN_SIGNUP_SECRET   (>= 32 chars or the first-admin endpoint is disabled)
openssl rand -hex 24     # → HEALTH_TOKEN
```
Fill `DATABASE_URL`, `REDIS_URL`, `R2_*`, `RESEND_API_KEY`, `EMAIL_FROM`. See `.env.example` for what each one does.
> ⚠️ **Do not keep a `.env.local`** next to `.env`: Next.js lets it silently override `.env`. If one exists and has the same values, delete it (`rm .env.local`).

## 4. Create the database schema
```bash
npm run db:status        # shows Applied / Pending
npm run db:up            # applies db/migrations/*.sql (idempotent — re-running does nothing)
```
Other migration commands: `npm run db:new -- add_something` (new file) · `npm run db:down` (undo the last one).
A fresh database ends with **18 migrations applied, 28 tables**.

## 5. Move the data from Supabase to local Postgres
Supabase is only ever **read** (a read-only transaction). Get the connection string from Supabase → *Connect* → **Session pooler**, then:
```bash
export SUPABASE_DB_URL='postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres'
```

### 5a. One-time safety archive (raw copy of everything, incl. `auth.users`)
```bash
npx tsx scripts/supabase-archive.ts          # prints the inventory, asks you to type the project ref
```
Creates a new local database `supabase_legacy`, **proves** it is identical (row counts + per-table content checksums),
then uploads one AES-256-encrypted copy to R2 (`db-backups/supabase-legacy/`). It never touches `iconic_connect`.
Re-run: add `--replace-target`. Inspect it: `docker exec -it iconic_dev_postgres psql -U postgres -d supabase_legacy`.
**Copy `~/.config/iconic/backup_key` somewhere safe** — the R2 copy cannot be decrypted without it.

### 5b. Load the data into the app's schema (`iconic_connect`)
```bash
npx tsx scripts/migrate-from-supabase.ts                  # DRY RUN: copies, verifies, prints a table, rolls everything back
npx tsx scripts/migrate-from-supabase.ts --apply          # real run (target must be empty)
npx tsx scripts/migrate-from-supabase.ts --apply --wipe   # re-run: ⚠️ first EMPTIES the local app tables
```
Password hashes are copied as-is: users keep their passwords (bcrypt is upgraded to argon2id on their first login).

## 6. Run the app
```bash
npm run dev                         # http://localhost:4000   (starts the background workers in-process)
curl -s localhost:4000/api/health   # {"ok":true,"db":true,"redis":true,"schema":true}
```
Production-like mode on your machine:
```bash
npm run build && npm run start      # build again after any code change, then restart
npx tsx src/lib/queue/worker.ts     # separate worker (emails, case cleanup, scheduled jobs) — only if you start with DISABLE_WORKER=true
```
**First admin** (only needed on an empty database — after step 5b your existing admins can sign in):
```bash
curl -s -X POST localhost:4000/api/admin/user -H "x-admin-secret: $ADMIN_SIGNUP_SECRET" -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"Str0ng!Passw0rd","fullName":"Your Name","phone":"+911234567890"}'
```
(Or use the admin sign-up page, `/admin/sign-up`.)

## 7. Backups to R2
```bash
npm run db:backup:r2                # fresh dump → AES-256 → upload → verify → then delete the previous one
npm run db:backup:r2 -- list
npm run db:backup:r2 -- restore     # newest → scratch database "restore_check_r2" (your real DB is untouched)
```
Daily at 02:30 (your user's crontab, `crontab -e`):
```
30 2 * * * cd /path/to/IconicConnect && npm run -s db:backup:r2 >> ~/iconic-backups/r2.log 2>&1
```

## 8. Everyday database work
```bash
docker exec -it iconic_dev_postgres psql -U postgres -d iconic_connect     # SQL shell
npm run db:up                                                              # after pulling new migrations
docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up -d && npm run db:up   # wipe & rebuild
```

## 9. Checks before you push
```bash
npx tsc --noEmit        # type check
npm test                # unit tests (vitest)
npm run build           # production build
```

## 10. Deploy to the server
See `deploy/README.md`: GitHub secrets → run **Provision server** (Docker, hardened Postgres/Redis, firewall, nightly backups) →
deploy. The deploy workflow calls `/api/health` and fails if the app is unhealthy.

## 11. Troubleshooting
| Symptom | Cause → fix |
|---|---|
| `port is already allocated` on 5433/6380 | Another container uses it → `docker ps`; stop it or set `PG_PORT=…`/`REDIS_PORT=…` and update `.env` |
| `ECONNREFUSED 127.0.0.1:5433` | Postgres not running → `docker compose -f docker-compose.dev.yml ps` |
| `SSL is not enabled on the server` | Add `?sslmode=disable` to `DATABASE_URL` (local Postgres has no TLS) |
| App uses wrong DB/Redis after editing `.env` | A stale `.env.local` overrides it → delete `.env.local`; restart `npm run dev` |
| Every page hangs / returns 503 | Redis is down → `docker compose … ps`; `/api/health` shows `"redis":false` |
| `relation "…" does not exist` / `/api/health` → `"schema":false` | Migrations not applied → `npm run db:up` |
| `Supabase connection string not found` | `export SUPABASE_DB_URL='postgresql://postgres.<ref>:<pw>@<host>:5432/postgres'` |
| Admin sign-up returns 403 | `ADMIN_SIGNUP_SECRET` shorter than 32 chars → `openssl rand -hex 32` |
| Logged out after restarting Redis | Redis started without persistence → use the compose file (it enables `appendonly`) |
