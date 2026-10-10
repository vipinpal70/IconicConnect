#!/usr/bin/env bash
# Consistent logical backup of the iconic_connect database, verified, with retention.
# Atomic: written to a .tmp file, test-listed with pg_restore, only then renamed — a failed run never leaves a
# half-written file that looks like a good backup.
set -Eeuo pipefail
umask 077
CONTAINER="${PG_CONTAINER:-iconic_postgres}"
DB="${POSTGRES_DB:-iconic_connect}"
USER_="${POSTGRES_USER:-iconic}"
DIR="${BACKUP_DIR:-/var/backups/iconic}"
KEEP_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$DIR/${DB}_${STAMP}.dump"
PASSWORD_FILE="${PG_PASSWORD_FILE:-${INSTALL_DIR:-/opt/iconic}/secrets/postgres_password}"

mkdir -p "$DIR"
trap 'rm -f "$OUT.tmp"' ERR EXIT          # never leave a partial file behind (the rename below disarms nothing: it moves it away)
# Postgres requires SCRAM auth even on the local socket, so pg_dump needs the password. It travels in the
# environment (docker exec -e NAME, no value = taken from OUR env) — never on a command line / process list.
PGPASSWORD="$(cat "$PASSWORD_FILE")"; export PGPASSWORD
docker exec -e PGPASSWORD "$CONTAINER" pg_dump -w -U "$USER_" -d "$DB" -Fc --no-owner > "$OUT.tmp"
# Prove the archive is readable before trusting it.
docker exec -i -e PGPASSWORD "$CONTAINER" pg_restore --list < "$OUT.tmp" > /dev/null
mv "$OUT.tmp" "$OUT"
find "$DIR" -name "${DB}_*.dump" -type f -mtime "+${KEEP_DAYS}" -delete
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1)); kept ${KEEP_DAYS} days"
