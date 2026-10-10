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

## Honest limits (read once)
* **Backups live on the same disk.** A dead disk loses the DB *and* its backups. Copy `/var/backups/iconic` off the
  server (rclone → R2/S3 is a 10-line addition) before you rely on it.
* **One database role.** The app and migrations share the `iconic` role (a superuser *inside the container*). That is
  acceptable while the DB is loopback-only and queries are parameterised, but a split (owner for migrations, DML-only
  role for the app) is the next hardening step.
* **No TLS on loopback.** Traffic never leaves the host, so it is unencrypted by design; if you ever move the DB to a
  separate machine, enable `ssl=on` and drop `?sslmode=disable`.
* **`HARDEN_SSH`** is off by default. Turn it on only after confirming key login works from a second terminal.
* **`chmod -R 777 case_data`** in `deploy.yml` is world-writable; tighten it to the app user when convenient.
