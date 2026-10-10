#!/usr/bin/env bash
# Back up your LOCAL Docker Postgres to Cloudflare R2 (and restore it), using the R2 credentials already in .env.
#
#   npm run db:backup:r2              take a fresh dump → encrypt → upload → verify → THEN delete the previous one
#   npm run db:backup:r2 -- list      list backups in R2
#   npm run db:backup:r2 -- restore   newest backup → scratch database "restore_check_r2" (your real DB is untouched)
#
# Everything here is read-only for your database (pg_dump). In R2 it only ever touches  db-backups/local-dev/  —
# a prefix the app's cleanup/retention jobs are forbidden to touch (src/lib/r2-objects.ts).
#
# Optional env:  R2_KEEP_BACKUPS (default 1)   LOCAL_BACKUP_DIR (default ~/iconic-backups/local)
#                BACKUP_KEY_FILE (default ~/.config/iconic/backup_key)   LOCAL_PG_CONTAINER (auto-detected)
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/.."
ACTION="${1:-backup}"

[ -f .env ] || { echo "no .env in $(pwd)" >&2; exit 1; }
envval() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }

# ── R2 (from .env; mapped to the names the deploy scripts expect — the secret never goes on a command line) ──
R2_ACCOUNT_ID="$(envval R2_ACCOUNT_ID)"
R2_ACCESS_KEY_ID="$(envval R2_ACCESS_KEY_ID)"
R2_SECRET_ACCESS_KEY="$(envval R2_SECRET_ACCESS_KEY)"
R2_BACKUP_BUCKET="$(envval R2_BUCKET)"
export R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BACKUP_BUCKET
export R2_BACKUP_PREFIX="db-backups/local-dev/"
export R2_KEEP_BACKUPS="${R2_KEEP_BACKUPS:-1}"
export R2_BACKUP_ENV=/nonexistent        # ignore any server-side config file; this run is driven by .env only

# ── local Postgres: user / db / port from DATABASE_URL, container found by its published port ──
URL="$(envval DATABASE_URL)"
case "$URL" in postgres*://*@localhost:*|postgres*://*@127.0.0.1:*) ;; *) echo "DATABASE_URL does not point at localhost — refusing (this script is for the LOCAL database)" >&2; exit 1;; esac
PGUSER_="$(sed -E 's#^[a-z]+://([^:@/]+).*#\1#' <<<"$URL")"
PGPASS_="$(sed -E 's#^[a-z]+://[^:@/]+:([^@]*)@.*#\1#' <<<"$URL")"
PGPORT_="$(sed -E 's#^.*@[^:/]+:([0-9]+)/.*#\1#' <<<"$URL")"
PGDB_="$(sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#' <<<"$URL")"
CONTAINER="${LOCAL_PG_CONTAINER:-$(docker ps --filter "publish=$PGPORT_" --format '{{.Names}}' | head -1)}"
[ -n "$CONTAINER" ] || { echo "no running Docker container publishes port $PGPORT_ (is Postgres up?)" >&2; exit 1; }

PWFILE="$(mktemp)"; trap 'rm -f "$PWFILE"' EXIT; printf '%s' "$PGPASS_" > "$PWFILE"
export PG_CONTAINER="$CONTAINER" POSTGRES_USER="$PGUSER_" POSTGRES_DB="$PGDB_" PG_PASSWORD_FILE="$PWFILE"
export BACKUP_DIR="${LOCAL_BACKUP_DIR:-$HOME/iconic-backups/local}"

# ── client-side encryption: the dump holds real users' emails + password hashes ──
KEYFILE="${BACKUP_KEY_FILE:-$HOME/.config/iconic/backup_key}"
if [ ! -s "$KEYFILE" ]; then
  mkdir -p "$(dirname "$KEYFILE")"; openssl rand -hex 32 > "$KEYFILE"; chmod 600 "$KEYFILE"
  echo "🔑 generated a new backup encryption key: $KEYFILE"
  echo "   ⚠️  COPY THIS FILE somewhere safe (password manager). Without it the backups in R2 cannot be decrypted."
fi
export BACKUP_ENCRYPTION_KEY_FILE="$KEYFILE"

echo "database : $PGDB_  (container $CONTAINER, port $PGPORT_)"
echo "R2       : bucket '$R2_BACKUP_BUCKET', prefix '$R2_BACKUP_PREFIX', keep newest $R2_KEEP_BACKUPS"
case "$ACTION" in
  backup)  FORCE_FRESH_DUMP=1 ./deploy/backup-to-r2.sh ;;     # always a brand-new dump, never reuse an old file
  list)    ./deploy/restore-from-r2.sh --list ;;
  restore) TARGET_DB="${TARGET_DB:-restore_check_r2}" ./deploy/restore-from-r2.sh ;;
  *) echo "usage: $0 [backup|list|restore]" >&2; exit 2 ;;
esac
