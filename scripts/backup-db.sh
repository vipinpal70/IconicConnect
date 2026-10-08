#!/usr/bin/env bash
# Full backup of the database in .env (DATABASE_URL) — read-only (pg_dump never writes to the DB).
#
#   npm run db:backup
#
# Writes to ~/backups/iconic-<db>-<timestamp>/ (outside the repo, chmod 600):
#   full.dump     everything: public + auth (users, password hashes) + storage records   (pg_restore format)
#   auth.dump     auth schema only
#   schema.sql    structure only (no data)
#   counts.txt    row counts of the main tables, for comparing after the upgrade
#
# Uses a local pg_dump if it is version 17+, otherwise Docker (postgres:17-alpine).
# The dump contains password hashes, tokens and emails — keep it private, never commit it.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env found in $(pwd)"; exit 1; }
URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
[ -n "$URL" ] || { echo "DATABASE_URL is not set in .env"; exit 1; }

# pg_dump needs a session-mode connection: the pooler's transaction port 6543 -> 5432,
# and it rejects the ?pgbouncer=true query option.
URL=$(printf '%s' "$URL" | sed -e 's/:6543\//:5432\//' -e 's/[?&]pgbouncer=true//')

# Show where we are connecting, without the password.
SAFE=$(printf '%s' "$URL" | sed -E 's#(://[^:]+):[^@]+@#\1:****@#')
DBNAME=$(printf '%s' "$URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
echo "Backing up: $SAFE"

STAMP=$(date +%F-%H%M%S)
OUT="$HOME/backups/iconic-$DBNAME-$STAMP"
mkdir -p "$OUT"
chmod 700 "$OUT"

# Pick the client: local pg_dump >= 17, else Docker.
LOCAL_MAJOR=$(pg_dump --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
export PGURL="$URL"
if [ -n "${LOCAL_MAJOR:-}" ] && [ "$LOCAL_MAJOR" -ge 17 ]; then
  echo "Using local pg_dump $LOCAL_MAJOR"
  DUMP()    { pg_dump "$PGURL" "$@"; }
  RESTORE() { pg_restore "$@"; }
  PSQL()    { psql "$PGURL" "$@"; }
  OUTDIR="$OUT"
else
  command -v docker >/dev/null || { echo "Need pg_dump 17+ or Docker (found pg_dump: ${LOCAL_MAJOR:-none})."; exit 1; }
  echo "Using Docker postgres:17-alpine (local pg_dump: ${LOCAL_MAJOR:-none})"
  D() { docker run --rm --network host -u "$(id -u):$(id -g)" -e PGURL -v "$OUT:/out" postgres:17-alpine "$@"; }
  DUMP()    { D sh -c 'pg_dump "$PGURL" "$@"' _ "$@"; }
  RESTORE() { D pg_restore "$@"; }
  PSQL()    { D sh -c 'psql "$PGURL" "$@"' _ "$@"; }
  OUTDIR=/out
fi

echo "1/4 full dump ..."
DUMP -Fc -f "$OUTDIR/full.dump"
echo "2/4 auth schema ..."
DUMP -Fc --schema=auth -f "$OUTDIR/auth.dump"
echo "3/4 schema only ..."
DUMP --schema-only -f "$OUTDIR/schema.sql"

echo "4/4 row counts + verification ..."
PSQL -Atc "
select 'cases='||(select count(*) from public.cases)
 ||' profiles='||(select count(*) from public.profiles)
 ||' client_price_list='||(select count(*) from public.client_price_list)
 ||' service_catalog='||(select count(*) from public.service_catalog)
 ||' case_files='||(select count(*) from public.case_files)
 ||' activity_logs='||(select count(*) from public.activity_logs)
 ||' notifications='||(select count(*) from public.notifications)
 ||' preference_forms='||(select count(*) from public.preference_forms)
 ||' auth_users='||(select count(*) from auth.users);" > "$OUT/counts.txt"

# The dump must list the key tables' data.
# (Write the list to a file and grep the file — `printf | grep -q` can false-fail under pipefail.)
RESTORE -l "$OUTDIR/full.dump" > "$OUT/restore-list.txt"
MISSING=0
for t in "public cases" "public profiles" "public client_price_list" "auth users"; do
  if ! grep -E "TABLE DATA $t " "$OUT/restore-list.txt" > /dev/null; then echo "  ✗ missing table data: $t"; MISSING=1; fi
done
[ "$MISSING" -eq 0 ] || { echo "Backup verification FAILED"; exit 1; }

chmod 600 "$OUT"/*
echo
echo "Backup OK → $OUT"
ls -lh "$OUT"
echo
echo "Row counts: $(cat "$OUT/counts.txt")"
echo
echo "Keep this folder private (password hashes inside) and copy it somewhere off this machine."
