# Server setup: Docker + PostgreSQL + Redis (hardened)

One command provisions a fresh Ubuntu/Debian server; CI runs the same script
(`.github/workflows/provision-infra.yml`). It is **idempotent** — re-running never rotates a password or breaks a
running database.

```
Internet ──443──▶ Cloudflare ──▶ nginx ──▶ Next.js (PM2, :4000)        ← the only things people can reach
                                                  │ 127.0.0.1
                                  ┌───────────────┴──────────────┐
                                  ▼                              ▼
                        PostgreSQL (docker :5433)         Redis (docker :6380)    ← loopback only, passwords, no internet
```

## What it sets up
| Layer | Setting |
|---|---|
| Docker | Official apt repo, key fingerprint verified; log rotation, `live-restore`, `no-new-privileges` |
| Firewall | `ufw`: deny all incoming except SSH (rate-limited), 80, 443 |
| Containers | all capabilities dropped (only what the entrypoint needs added back), memory/pid limits, Redis root FS read-only |
| Postgres 16 | SCRAM-SHA-256 only, data checksums, password from a **Docker secret file** (never in `docker inspect`) |
| Redis 7 | password, AOF persistence (logins survive restarts), `noeviction` (sessions + queues are never evicted), `FLUSHALL/FLUSHDB/DEBUG` disabled |
| Host | `fail2ban` (ssh), unattended security upgrades, optional key-only SSH |
| Backups | nightly `pg_dump` → `/var/backups/iconic`, verified with `pg_restore --list`, 14-day retention |
| Self-check | `verify-server.sh` fails the run if any DB/Redis port is reachable from outside |

## One-time setup

1. **Server user.** An SSH user with passwordless sudo (the VPS `ubuntu` user normally has it) and your **public key** in
   `~/.ssh/authorized_keys`. Use a key dedicated to CI (`ssh-keygen -t ed25519 -f ci_key -N ""`).
2. **GitHub → Settings → Secrets and variables → Actions**, add:

   | Secret | Value |
   |---|---|
   | `VPS_HOST` / `VPS_PORT` / `VPS_USERNAME` | server IP or hostname / SSH port / user |
   | `VPS_SSH_KEY` | contents of the **private** key `ci_key` |
   | `VPS_KNOWN_HOSTS` | output of `ssh-keyscan -p <port> <host>` (**verify the fingerprint** against the server console first) |
   | `VPS_FINGERPRINT` | `SHA256:…` of the server host key (`ssh-keygen -lf <(ssh-keyscan -p <port> <host> 2>/dev/null)`), used by `deploy.yml` |

3. **GitHub → Settings → Environments → New environment `production`** → add *Required reviewers*. The provision job
   has root on your server; this stops anyone running it unreviewed.
4. **Run it:** Actions → *Provision server* → *Run workflow*. First time tick **write_app_env** so
   `DATABASE_URL` / `REDIS_URL` are added to `/home/ubuntu/iconicconnect/.env` (a `.bak.provision` copy is kept).
5. Deploy the app (`deploy.yml`) — it runs the dbmate migrations (`npm run db:deploy`) against the new database.

Manual alternative (no CI): `scp -r deploy user@server:/tmp/ && ssh user@server 'sudo bash /tmp/deploy/setup-server.sh'`

## Port map
| Service | Container port | Host binding | Reachable from |
|---|---|---|---|
| PostgreSQL | 5432 | `127.0.0.1:5433` | this server only |
| Redis | 6379 | `127.0.0.1:6380` | this server only |
| Adminer (opt-in) | 8080 | `127.0.0.1:8081` | this server only (SSH tunnel) |
| Next.js (PM2) | – | `:4000` behind nginx | public only via nginx 80/443 |

> **Never publish 5432/6379 on `0.0.0.0`.** Docker writes its own iptables rules that **bypass ufw**, so a
> `ports: "5433:5432"` line exposes the database to the whole internet *even with ufw enabled*. (The dev
> `docker-compose.yml` on a laptop publishes on all interfaces — fine on a laptop, **never copy it to a server**.)
> CI fails if any published port in `deploy/docker-compose.prod.yml` is not `127.0.0.1`.

## "How do I view it from my external IP?"
*The website:* it is already public through Cloudflare → nginx on 443 using your domain
(`connectapp.theiconicdental.com`). Browse to the domain, not `http://<ip>:4000` (4000 is intentionally closed; use the
domain so you get TLS, the WAF and rate limits).

*The database / Adminer:* do **not** open ports to your IP. Tunnel over SSH — encrypted, key-authenticated,
and nothing new is exposed:

```bash
# Database client (DBeaver, psql, TablePlus…) on YOUR machine → localhost:5433
ssh -N -L 5433:127.0.0.1:5433 ubuntu@<server-ip>          # leave running
psql "postgresql://iconic:<password>@127.0.0.1:5433/iconic_connect?sslmode=disable"

# Adminer web UI: start it, tunnel, open http://localhost:8081, then stop it
ssh ubuntu@<server-ip> 'cd /opt/iconic && sudo docker compose --profile tools up -d adminer'
ssh -N -L 8081:127.0.0.1:8081 ubuntu@<server-ip>
#   System: PostgreSQL · Server: postgres · user: iconic · database: iconic_connect
ssh ubuntu@<server-ip> 'cd /opt/iconic && sudo docker compose --profile tools stop adminer'

# Read the password (root only):
ssh ubuntu@<server-ip> 'sudo cat /opt/iconic/secrets/postgres_password'
```

## Health check — "is this deployment wired up correctly?"
`GET /api/health` (public, no login) answers in milliseconds: `{ "ok": true, "db": true, "redis": true, "schema": true }`
with HTTP 200, or 503 with the failing part set to `false`. Set `HEALTH_TOKEN=<random string>` in the app's `.env` and send
it as header `x-health-token` to also get the precise reason, timings and `applied/expected` migration counts:
```bash
curl -s -H "x-health-token: $HEALTH_TOKEN" https://connectapp.theiconicdental.com/api/health
```
`deploy.yml` calls it after every deploy and **fails the pipeline** if the app is unhealthy. Point an uptime monitor at it too.

## Everyday operations
```bash
sudo /opt/iconic/bin/verify-server.sh                 # security + health self-check
cd /opt/iconic && sudo docker compose ps              # status
sudo docker logs --tail 100 iconic_postgres           # logs (auto-rotated)
sudo systemctl start iconic-backup.service            # backup now;  list: ls -lh /var/backups/iconic
systemctl list-timers iconic-backup.timer             # next scheduled backup
```
**Restore** a backup into a *scratch* database first, then decide:
```bash
sudo bash -c 'export PGPASSWORD=$(cat /opt/iconic/secrets/postgres_password)
  docker exec -e PGPASSWORD iconic_postgres createdb -h 127.0.0.1 -U iconic restore_check
  docker exec -i -e PGPASSWORD iconic_postgres pg_restore -h 127.0.0.1 -U iconic -d restore_check --no-owner < /var/backups/iconic/<file>.dump'
```
**Upgrade Postgres/Redis images:** edit `POSTGRES_IMAGE` / `REDIS_IMAGE` in `/opt/iconic/.env` (pin by digest), re-run the
provision workflow. A *major* Postgres upgrade (16 → 17) needs dump/restore — take a backup first.

## Off-site backups → Cloudflare R2 (daily, upload first, then delete the old one)
Every night at ~02:45 `iconic-backup-r2.timer` runs `backup-to-r2.sh`:

1. take (or reuse tonight's) verified `pg_dump` → 2. *(optional)* encrypt → 3. upload with `Content-MD5` and re-check
size + MD5 on R2 → 4. **only then** delete older backups, keeping the newest `R2_KEEP_BACKUPS` (default **1**).

If any step fails the script stops *before* the delete step, so the previous backup is never removed on a bad night,
and `HEALTHCHECK_URL` (if set) receives `/fail`. Only objects named `db-backups/iconic_connect_<timestamp>.dump[.enc]`
are ever deleted; anything else in the bucket is left alone (max 50 deletions per run as a sanity guard).

**Set up (5 minutes)**
1. Cloudflare → R2 → **Create a NEW bucket** (e.g. `iconic-db-backups`). ⚠️ *Never* reuse the app's file bucket: the app's
   `r2-cleanup` job deletes every object the database doesn't reference, which would include your backups.
2. R2 → *Manage API tokens* → create a token with **Object Read & Write**, scoped to **only that bucket**. Note the
   Account ID, Access Key ID and Secret.
3. Give them to the server — either way:
   * GitHub secrets `R2_BACKUP_ACCOUNT_ID`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `R2_BACKUP_BUCKET`
     (optional: `R2_KEEP_BACKUPS`, `BACKUP_HEALTHCHECK_URL`, `BACKUP_ENCRYPTION_KEY`) → re-run *Provision server*; or
   * edit `/opt/iconic/r2-backup.env` on the server, then `sudo systemctl enable --now iconic-backup-r2.timer`.
4. Test it now: `sudo systemctl start iconic-backup-r2.service && journalctl -u iconic-backup-r2.service -n 20`.

### Backing up your LOCAL (laptop) database to R2
Uses the R2 credentials already in `.env`; no server needed.
```bash
npm run db:backup:r2              # fresh dump → AES-256 encrypt → upload → verify → then delete the previous one
npm run db:backup:r2 -- list      # what is stored
npm run db:backup:r2 -- restore   # newest → scratch database "restore_check_r2" (your real DB is never touched)
```
Stored under `db-backups/local-dev/` (separate from any server backup prefix, so they can never prune each other).
The key is generated once at `~/.config/iconic/backup_key` — **copy it somewhere safe**; backups cannot be decrypted without it.
The app's R2 orphan-cleanup and 3-month retention jobs are hard-blocked from `db-backups/` (`src/lib/r2-objects.ts`),
so sharing the app bucket is safe — a dedicated bucket + scoped token is still the better long-term setup.

### One-time archive of the old Supabase database
`npx tsx scripts/supabase-archive.ts` (already run once) takes a **read-only** consistent snapshot of the live Supabase
project (auth, public, storage, realtime, vault, drizzle), restores it into a NEW local database `supabase_legacy`,
proves it identical (row counts + per-table content checksums + structure), then uploads ONE AES-256-encrypted copy
to `db-backups/supabase-legacy/` in R2 (never auto-deleted) and re-downloads it to prove it decrypts to the same bytes.
It never uses `pg_dump` (the live server is Postgres 17, local is 16), never writes to Supabase, and refuses to touch
`iconic_connect`. The archive is plain SQL: see `RESTORE.txt` inside it — `gunzip -c file.sql.gz | psql` is all you need.

**Recommended:** set `R2_KEEP_BACKUPS=3`. With 1, a backup that uploads fine but turns out to be bad (logical
corruption you only notice a week later) replaces your last good copy. R2 storage for three small dumps costs almost nothing.
Add a free [healthchecks.io](https://healthchecks.io) URL as `HEALTHCHECK_URL` so you are *told* if backups stop running.

**Encryption (optional).** `BACKUP_ENCRYPTION_KEY_FILE` enables client-side AES-256 so Cloudflare can't read the dump
(it contains customer data). Generate with `openssl rand -hex 32`. **Store a copy of the key somewhere that is not this
server (password manager)** — if the server dies with the only copy of the key, the backups are unreadable.

**Restore (test this once, now — an untested backup is a hope, not a backup)**
```bash
sudo /opt/iconic/bin/restore-from-r2.sh --list                 # what is in R2
sudo /opt/iconic/bin/restore-from-r2.sh                        # newest → scratch database "restore_check" (live DB untouched)
sudo BACKUP_ENCRYPTION_KEY_FILE=/path/to/key /opt/iconic/bin/restore-from-r2.sh db-backups/<object>.dump.enc
```
Disaster recovery on a new server: provision it, restore into a scratch DB, check the data, then
`pg_dump`/`pg_restore` into `iconic_connect` (or restore with `--clean` after stopping the app).

## Honest limits (read once)
* **Local backups share the disk with the database.** That is why the R2 off-site job above exists — make sure it is
  configured (`verify-server.sh` prints SKIP until it is).
* **One database role.** The app and migrations share the `iconic` role (a superuser *inside the container*). That is
  acceptable while the DB is loopback-only and queries are parameterised, but a split (owner for migrations, DML-only
  role for the app) is the next hardening step.
* **No TLS on loopback.** Traffic never leaves the host, so it is unencrypted by design; if you ever move the DB to a
  separate machine, enable `ssl=on` and drop `?sslmode=disable`.
* **`HARDEN_SSH`** is off by default. Turn it on only after confirming key login works from a second terminal.
* **`chmod -R 777 case_data`** in `deploy.yml` is world-writable; tighten it to the app user when convenient.
