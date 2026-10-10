#!/usr/bin/env bash
# Download a backup from R2, verify (and decrypt) it, and restore it into a SCRATCH database so you can inspect it.
# It never touches the live database.
#
#   restore-from-r2.sh                       # newest backup → scratch DB "restore_check"
#   restore-from-r2.sh <object-key>          # a specific backup
#   restore-from-r2.sh --list                # just list what R2 holds
#   TARGET_DB=my_scratch restore-from-r2.sh
set -Eeuo pipefail
umask 077
INSTALL_DIR="${INSTALL_DIR:-/opt/iconic}"
CONF="${R2_BACKUP_ENV:-$INSTALL_DIR/r2-backup.env}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${PG_CONTAINER:-iconic_postgres}"
PG_USER="${POSTGRES_USER:-iconic}"
TARGET_DB="${TARGET_DB:-restore_check}"
LIVE_DB="${POSTGRES_DB:-iconic_connect}"

# shellcheck source=lib-r2.sh
. "$HERE/lib-r2.sh"
r2_load_config_file "$CONF"
r2_require_config

[ "$TARGET_DB" != "$LIVE_DB" ] || { echo "refusing: TARGET_DB is the live database" >&2; exit 1; }
if [ "${1:-}" = "--list" ]; then r2_list_keys; exit 0; fi
KEY="${1:-$(r2_list_keys | grep -E '\.dump(\.enc)?$' | tail -1)}"
[ -n "$KEY" ] || { echo "no backups found in R2" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "downloading $KEY"
r2_get "$KEY" "$TMP/object"
FILE="$TMP/object"
if [[ "$KEY" == *.enc ]]; then
  [ -s "${BACKUP_ENCRYPTION_KEY_FILE:-}" ] || { echo "backup is encrypted: set BACKUP_ENCRYPTION_KEY_FILE" >&2; exit 1; }
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$BACKUP_ENCRYPTION_KEY_FILE" -in "$TMP/object" -out "$TMP/plain.dump"
  FILE="$TMP/plain.dump"
fi

PGPASSWORD="$(cat "${PG_PASSWORD_FILE:-$INSTALL_DIR/secrets/postgres_password}")"; export PGPASSWORD
docker exec -i -e PGPASSWORD "$CONTAINER" pg_restore --list < "$FILE" > /dev/null && echo "✔ archive is valid"
docker exec -e PGPASSWORD "$CONTAINER" dropdb   -h 127.0.0.1 -U "$PG_USER" --if-exists "$TARGET_DB"
docker exec -e PGPASSWORD "$CONTAINER" createdb -h 127.0.0.1 -U "$PG_USER" "$TARGET_DB"
docker exec -i -e PGPASSWORD "$CONTAINER" pg_restore -h 127.0.0.1 -U "$PG_USER" -d "$TARGET_DB" --no-owner < "$FILE"
echo "✔ restored into scratch database '$TARGET_DB':"
docker exec -e PGPASSWORD "$CONTAINER" psql -h 127.0.0.1 -U "$PG_USER" -d "$TARGET_DB" -tAc \
  "select 'tables='||count(*) from pg_tables where schemaname='public'"
echo "Inspect it, then drop it:  docker exec -e PGPASSWORD iconic_postgres dropdb -h 127.0.0.1 -U $PG_USER $TARGET_DB"
