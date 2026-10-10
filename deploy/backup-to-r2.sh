#!/usr/bin/env bash
# Daily OFF-SITE backup: take a verified dump → upload to Cloudflare R2 → verify the upload → ONLY THEN delete the
# older backups (keeping R2_KEEP_BACKUPS newest, default 1). The order is the safety property: at no point is there
# a window where the only good copy is the one being deleted.
#
#   backup-to-r2.sh              (systemd timer: iconic-backup-r2.timer, 02:45 daily)
#
# Config (root-only, mode 600): /opt/iconic/r2-backup.env
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET     (required)
#   R2_BACKUP_PREFIX=db-backups/   R2_KEEP_BACKUPS=1   (optional)
#   BACKUP_ENCRYPTION_KEY_FILE=/opt/iconic/secrets/backup_key   (optional client-side AES-256 encryption)
#   HEALTHCHECK_URL=https://hc-ping.com/<uuid>   (optional dead-man's switch: pinged on success, /fail on failure)
set -Eeuo pipefail
umask 077

INSTALL_DIR="${INSTALL_DIR:-/opt/iconic}"
CONF="${R2_BACKUP_ENV:-$INSTALL_DIR/r2-backup.env}"
LOCAL_DIR="${BACKUP_DIR:-/var/backups/iconic}"
DB="${POSTGRES_DB:-iconic_connect}"
MAX_AGE_HOURS="${MAX_LOCAL_AGE_HOURS:-26}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib-r2.sh
. "$HERE/lib-r2.sh"
r2_load_config_file "$CONF"
KEEP="${R2_KEEP_BACKUPS:-1}"

# Configuration errors are the operator's problem, not a failed backup run: validate BEFORE arming the failure
# trap so they exit 2 with a clear message and do not fire the /fail monitoring ping.
r2_require_config || exit 2
case "$KEEP" in ''|*[!0-9]*|0) echo "R2_KEEP_BACKUPS must be a positive integer (got '$KEEP')" >&2; exit 2;; esac

ping() { [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 2 -o /dev/null "${HEALTHCHECK_URL}${1:-}" || true; }
TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; }
fail()    { echo "✖ R2 backup FAILED at line $1" >&2; ping /fail; }
trap 'fail $LINENO' ERR
trap cleanup EXIT

# One run at a time (a manual run must not overlap the timer).
mkdir -p "$LOCAL_DIR"
exec 9>"$LOCAL_DIR/.r2-backup.lock"
flock -n 9 || { echo "another R2 backup is already running"; exit 0; }

# 1 ─ a fresh, verified local dump (reuse tonight's local backup if it is recent, else take one now)
latest_local() { find "$LOCAL_DIR" -maxdepth 1 -name "${DB}_*.dump" -type f -mmin "-$((MAX_AGE_HOURS * 60))" -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-; }
SRC="$(latest_local || true)"
if [ -z "$SRC" ]; then
  echo "no local dump newer than ${MAX_AGE_HOURS}h — taking one now"
  BACKUP_DIR="$LOCAL_DIR" "$HERE/backup-postgres.sh"
  SRC="$(latest_local)"
fi
[ -s "$SRC" ] || { echo "no usable local dump found" >&2; exit 1; }
echo "source: $SRC ($(du -h "$SRC" | cut -f1))"

# 2 ─ optional client-side encryption (the dump holds customer data; R2 encrypts at rest, this adds a layer that
#     Cloudflare cannot read). KEEP THE KEY OFF THIS SERVER TOO — without it the backup is unrecoverable.
TMP="$(mktemp -d)"
UPLOAD="$SRC"; KEY_NAME="$(basename "$SRC")"
if [ -n "${BACKUP_ENCRYPTION_KEY_FILE:-}" ]; then
  [ -s "$BACKUP_ENCRYPTION_KEY_FILE" ] || { echo "BACKUP_ENCRYPTION_KEY_FILE not found / empty" >&2; exit 1; }
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$BACKUP_ENCRYPTION_KEY_FILE" -in "$SRC" -out "$TMP/payload.enc"
  UPLOAD="$TMP/payload.enc"; KEY_NAME="${KEY_NAME}.enc"
fi
OBJECT_KEY="${R2_BACKUP_PREFIX}${KEY_NAME}"

# 3 ─ upload + verify (size, MD5 via Content-MD5/ETag). r2_put removes the object itself if verification fails.
echo "uploading → r2://$R2_BACKUP_BUCKET/$OBJECT_KEY"
r2_put "$OBJECT_KEY" "$UPLOAD"
echo "✔ uploaded and verified ($(stat -c %s "$UPLOAD") bytes)"

# 4 ─ ONLY NOW retire older backups. Match strictly our own file pattern; never touch anything else in the bucket;
#     refuse to delete suspiciously many objects in one run.
mapfile -t ALL < <(r2_list_keys | grep -E "^${R2_BACKUP_PREFIX}${DB}_[0-9_-]+\.dump(\.enc)?$" || true)
printf '%s\n' "${ALL[@]}" | grep -qxF "$OBJECT_KEY" || { echo "new backup not visible in listing — NOT deleting anything" >&2; exit 1; }
if [ "${#ALL[@]}" -gt "$KEEP" ]; then
  TO_DELETE=("${ALL[@]:0:${#ALL[@]}-KEEP}")
  [ "${#TO_DELETE[@]}" -le 50 ] || { echo "refusing to delete ${#TO_DELETE[@]} objects in one run (limit 50)" >&2; exit 1; }
  for k in "${TO_DELETE[@]}"; do
    [ "$k" = "$OBJECT_KEY" ] && continue            # belt and braces: never delete what we just uploaded
    r2_delete "$k" && echo "🗑  removed old backup $k"
  done
fi
echo "✔ R2 now holds: $(r2_list_keys | grep -cE "^${R2_BACKUP_PREFIX}${DB}_") backup(s); keep=$KEEP"
ping
