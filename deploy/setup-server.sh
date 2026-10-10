#!/usr/bin/env bash
# Idempotent server provisioning for Ubuntu / Debian: Docker + hardened PostgreSQL 16 + Redis 7 + firewall.
# Safe to re-run any time (CI runs it on every change under deploy/). It never rotates existing secrets.
#
#   sudo bash deploy/setup-server.sh
#
# Environment switches (all optional):
#   INSTALL_DIR=/opt/iconic        where the stack + secrets live
#   APP_ENV_FILE=/home/ubuntu/iconicconnect/.env   app .env to receive DATABASE_URL / REDIS_URL
#   WRITE_APP_ENV=1                actually write them into APP_ENV_FILE (backup kept). Default: only print the path.
#   ENABLE_UFW=0                   skip the firewall (default 1)
#   HARDEN_SSH=1                   disable SSH password login + root login (default 0 — see README before enabling)
#   BACKUP_RETENTION_DAYS=14
set -Eeuo pipefail
trap 'echo "✖ provisioning failed at line $LINENO (command: $BASH_COMMAND)" >&2' ERR

INSTALL_DIR="${INSTALL_DIR:-/opt/iconic}"
APP_ENV_FILE="${APP_ENV_FILE:-}"
WRITE_APP_ENV="${WRITE_APP_ENV:-0}"
ENABLE_UFW="${ENABLE_UFW:-1}"
HARDEN_SSH="${HARDEN_SSH:-0}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root (sudo bash deploy/setup-server.sh)"
[ -r /etc/os-release ] || die "cannot detect OS"
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) die "unsupported OS '${ID:-?}' (Ubuntu/Debian only)";; esac
export DEBIAN_FRONTEND=noninteractive

# ───────────────────────────── 1. base packages ─────────────────────────────
log "Base packages"
apt-get update -y -qq
apt-get install -y -qq ca-certificates curl gnupg openssl ufw fail2ban unattended-upgrades >/dev/null
ok "ca-certificates curl gnupg openssl ufw fail2ban unattended-upgrades"

# ───────────────────────────── 2. Docker Engine ─────────────────────────────
# Official Docker apt repository. The signing key's fingerprint is checked against Docker's published value, so a
# tampered download is rejected rather than trusted.
DOCKER_KEY_FPR="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
install_docker() {
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /tmp/docker.asc
  local fpr; fpr="$(gpg --show-keys --with-colons /tmp/docker.asc | awk -F: '/^fpr:/ {print $10; exit}')"
  [ "$fpr" = "$DOCKER_KEY_FPR" ] || die "Docker GPG key fingerprint mismatch ($fpr) — refusing to continue"
  install -m 0644 /tmp/docker.asc /etc/apt/keyrings/docker.asc; rm -f /tmp/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
}
log "Docker Engine"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "already installed: $(docker --version)"
else
  install_docker; ok "installed: $(docker --version)"
fi

# Daemon defaults: rotate container logs (an unbounded json log is a classic disk-full outage), keep containers
# running while the daemon restarts, and block privilege escalation by default.
DAEMON_JSON=/etc/docker/daemon.json
DESIRED_DAEMON='{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true
}'
if [ ! -f "$DAEMON_JSON" ] || ! diff -q <(echo "$DESIRED_DAEMON") "$DAEMON_JSON" >/dev/null 2>&1; then
  [ -f "$DAEMON_JSON" ] && cp -a "$DAEMON_JSON" "$DAEMON_JSON.bak.$(date +%s)"
  echo "$DESIRED_DAEMON" > "$DAEMON_JSON"
  systemctl restart docker; ok "daemon.json updated (log rotation, live-restore, no-new-privileges)"
else
  ok "daemon.json already as desired"
fi
systemctl enable --now docker >/dev/null 2>&1

# ───────────────────────────── 3. firewall ──────────────────────────────────
# Only SSH + web are open. IMPORTANT: Docker edits iptables itself and bypasses ufw for PUBLISHED ports, so the
# data services are published on 127.0.0.1 only (see docker-compose.prod.yml) — ufw is the outer layer, loopback
# binding is the real guarantee. verify-server.sh checks both.
if [ "$ENABLE_UFW" = "1" ]; then
  log "Firewall (ufw)"
  SSH_PORTS="$(sshd -T 2>/dev/null | awk '/^port /{print $2}' | sort -u)"
  [ -n "$SSH_PORTS" ] || die "could not detect the SSH port — refusing to enable ufw (would risk locking you out)"
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  for p in $SSH_PORTS; do ufw limit "${p}/tcp" comment 'ssh (rate-limited)' >/dev/null; done
  ufw allow 80/tcp  comment 'http'  >/dev/null
  ufw allow 443/tcp comment 'https' >/dev/null
  ufw --force enable >/dev/null
  ok "default deny in; open: ssh(${SSH_PORTS//$'\n'/,}) 80 443"
else
  warn "ENABLE_UFW=0 — firewall left untouched"
fi

# ───────────────────────────── 4. fail2ban + auto security updates ──────────
log "Brute-force protection & automatic security updates"
cat > /etc/fail2ban/jail.d/iconic.local <<'JAIL'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
[sshd]
enabled = true
JAIL
systemctl enable --now fail2ban >/dev/null 2>&1 && systemctl restart fail2ban
ok "fail2ban: sshd jail (5 failures / 10 min → 1 h ban)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
ok "unattended security upgrades on"

# Optional: key-only SSH. Off by default so an automated run can never lock you out.
if [ "$HARDEN_SSH" = "1" ]; then
  log "SSH hardening"
  TARGET_USER="${SUDO_USER:-}"
  [ -n "$TARGET_USER" ] && [ -s "$(getent passwd "$TARGET_USER" | cut -d: -f6)/.ssh/authorized_keys" ] \
    || die "HARDEN_SSH=1 needs a non-root sudo user with a non-empty ~/.ssh/authorized_keys (else you would lock yourself out)"
  cat > /etc/ssh/sshd_config.d/99-iconic-hardening.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
X11Forwarding no
SSHD
  sshd -t || die "sshd config test failed — hardening file left in place for inspection, ssh NOT reloaded"
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  ok "password + root SSH login disabled (key auth only for ${TARGET_USER})"
fi

# ───────────────────────────── 5. the data stack ────────────────────────────
log "PostgreSQL + Redis stack in ${INSTALL_DIR}"
install -d -m 0750 "$INSTALL_DIR" "$INSTALL_DIR/bin"
install -m 0644 "$SRC_DIR/docker-compose.prod.yml" "$INSTALL_DIR/docker-compose.yml"
install -m 0750 "$SRC_DIR/render-secrets.sh"  "$INSTALL_DIR/bin/render-secrets.sh"
install -m 0750 "$SRC_DIR/backup-postgres.sh" "$INSTALL_DIR/bin/backup-postgres.sh"
install -m 0750 "$SRC_DIR/verify-server.sh"   "$INSTALL_DIR/bin/verify-server.sh"
install -m 0640 "$SRC_DIR/lib-r2.sh"          "$INSTALL_DIR/bin/lib-r2.sh"
install -m 0750 "$SRC_DIR/backup-to-r2.sh"    "$INSTALL_DIR/bin/backup-to-r2.sh"
install -m 0750 "$SRC_DIR/restore-from-r2.sh" "$INSTALL_DIR/bin/restore-from-r2.sh"
# Non-secret tunables only; passwords live in secrets/ and redis.conf.
[ -f "$INSTALL_DIR/.env" ] || cat > "$INSTALL_DIR/.env" <<'ENVF'
# Non-secret settings for docker-compose.yml (override here, then re-run the provision workflow).
PG_PORT=5433
REDIS_PORT=6380
PG_SHARED_BUFFERS=256MB
PG_EFFECTIVE_CACHE_SIZE=768MB
REDIS_MAXMEMORY=512mb
# Pin images by digest for fully reproducible deploys, e.g. POSTGRES_IMAGE=postgres:16-alpine@sha256:...
ENVF
chmod 640 "$INSTALL_DIR/.env"
( cd "$INSTALL_DIR" && set -a && . ./.env && set +a && ./bin/render-secrets.sh "$INSTALL_DIR" )

( cd "$INSTALL_DIR" && docker compose pull --quiet && docker compose up -d --wait --wait-timeout 180 )
ok "postgres + redis are up and healthy"

# ───────────────────────────── 6. nightly backups ───────────────────────────
log "Nightly PostgreSQL backups (retention ${BACKUP_RETENTION_DAYS} days)"
install -d -m 0700 /var/backups/iconic
cat > /etc/systemd/system/iconic-backup.service <<UNIT
[Unit]
Description=IconicConnect PostgreSQL backup
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
Environment=BACKUP_DIR=/var/backups/iconic
Environment=RETENTION_DAYS=${BACKUP_RETENTION_DAYS}
ExecStart=${INSTALL_DIR}/bin/backup-postgres.sh
Nice=10
UNIT
cat > /etc/systemd/system/iconic-backup.timer <<'UNIT'
[Unit]
Description=Nightly IconicConnect PostgreSQL backup
[Timer]
OnCalendar=*-*-* 02:15:00
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now iconic-backup.timer >/dev/null 2>&1
ok "iconic-backup.timer → /var/backups/iconic (02:15 daily)"

# ───────────────────────────── 6b. off-site backups → Cloudflare R2 ─────────
# Daily: dump → upload → verify → ONLY THEN delete older backups (R2_KEEP_BACKUPS, default 1). Credentials live in
# r2-backup.env (root-only). The timer is enabled only once that file is filled in, so an unconfigured server
# does not produce a failing unit every night.
log "Off-site backups to Cloudflare R2"
R2_ENV="$INSTALL_DIR/r2-backup.env"
if [ ! -f "$R2_ENV" ]; then
  cat > "$R2_ENV" <<'R2ENV'
# Cloudflare R2 off-site backup settings (root-only). Use a DEDICATED bucket and an API token scoped to ONLY that
# bucket with "Object Read & Write". Do NOT reuse the app's file bucket: the app's R2 orphan-cleanup job deletes every
# object the database does not reference — it would delete your backups.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BACKUP_BUCKET=
R2_BACKUP_PREFIX=db-backups/
# How many backups to keep in R2 after a successful upload (1 = only the newest). 3 is a safer default.
R2_KEEP_BACKUPS=1
# Optional: client-side AES-256 encryption (key file path). KEEP A COPY OF THE KEY OFF THIS SERVER or the backups are unrecoverable.
#BACKUP_ENCRYPTION_KEY_FILE=/opt/iconic/secrets/backup_key
# Optional dead-man's switch (healthchecks.io etc.): pinged on success, <url>/fail on failure.
#HEALTHCHECK_URL=
R2ENV
fi
chmod 600 "$R2_ENV"
cat > /etc/systemd/system/iconic-backup-r2.service <<UNIT
[Unit]
Description=IconicConnect off-site PostgreSQL backup to Cloudflare R2
After=docker.service iconic-backup.service network-online.target
Wants=network-online.target
Requires=docker.service
[Service]
Type=oneshot
Environment=INSTALL_DIR=${INSTALL_DIR}
Environment=BACKUP_DIR=/var/backups/iconic
ExecStart=${INSTALL_DIR}/bin/backup-to-r2.sh
TimeoutStartSec=2h
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
UNIT
cat > /etc/systemd/system/iconic-backup-r2.timer <<'UNIT'
[Unit]
Description=Daily off-site IconicConnect backup to R2
[Timer]
OnCalendar=*-*-* 02:45:00
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
if grep -Eq '^R2_BACKUP_BUCKET=.+' "$R2_ENV" && grep -Eq '^R2_ACCESS_KEY_ID=.+' "$R2_ENV" && grep -Eq '^R2_SECRET_ACCESS_KEY=.+' "$R2_ENV"; then
  systemctl enable --now iconic-backup-r2.timer >/dev/null 2>&1
  ok "iconic-backup-r2.timer enabled (02:45 daily → R2)"
else
  systemctl disable --now iconic-backup-r2.timer >/dev/null 2>&1 || true
  warn "R2 off-site backup NOT active yet — fill in ${R2_ENV} (or set the R2_BACKUP_* GitHub secrets) and re-run."
fi

# ───────────────────────────── 7. hand the URLs to the app ──────────────────
set_env_key() { # file key value — replace or append, keep owner/mode, one backup per run
  local f="$1" k="$2" v="$3"
  [ -f "$f" ] || die "APP_ENV_FILE '$f' does not exist"
  [ -f "$f.bak.provision" ] || cp -a "$f" "$f.bak.provision"
  if grep -q "^${k}=" "$f"; then
    local tmp; tmp="$(mktemp)"; awk -v k="$k" -v v="$v" -F= '$1==k{print k"="v; next}{print}' "$f" > "$tmp"
    cat "$tmp" > "$f"; rm -f "$tmp"
  else
    printf '\n%s=%s\n' "$k" "$v" >> "$f"
  fi
}
if [ "$WRITE_APP_ENV" = "1" ]; then
  [ -n "$APP_ENV_FILE" ] || die "WRITE_APP_ENV=1 requires APP_ENV_FILE"
  log "Updating ${APP_ENV_FILE}"
  # shellcheck disable=SC1091
  . "$INSTALL_DIR/connection.env"
  set_env_key "$APP_ENV_FILE" DATABASE_URL "$DATABASE_URL"
  set_env_key "$APP_ENV_FILE" REDIS_URL "$REDIS_URL"
  ok "DATABASE_URL and REDIS_URL written (backup: ${APP_ENV_FILE}.bak.provision)"
else
  warn "App .env NOT modified. Connection strings are in ${INSTALL_DIR}/connection.env (root-only);"
  warn "re-run with WRITE_APP_ENV=1 APP_ENV_FILE=/path/to/.env to apply them."
fi

# ───────────────────────────── 8. self-check ────────────────────────────────
log "Self-check"
export INSTALL_DIR
"$INSTALL_DIR/bin/verify-server.sh"
log "Done. Nothing is exposed except ssh/80/443. Admin tools: see deploy/README.md (SSH tunnel)."
