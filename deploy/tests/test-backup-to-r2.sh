#!/usr/bin/env bash
# Integration test for backup-to-r2.sh against a fake S3 server (moto). No Docker/Postgres needed: it feeds the
# script pre-made "dump" files. Guards the property that matters most — a backup is NEVER deleted unless a newer
# one was uploaded and verified.
#
# shellcheck disable=SC2034  # variables are consumed inside eval'd assertions
#   pip install "moto[server]==5.2.3" && bash deploy/tests/test-backup-to-r2.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"; PORT="${MOTO_PORT:-5566}"; MOTO="${MOTO_SERVER:-moto_server}"
FAILS=0
cleanup() { [ -n "${MOTO_PID:-}" ] && kill "$MOTO_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

"$MOTO" -H 127.0.0.1 -p "$PORT" >"$WORK/moto.log" 2>&1 &
MOTO_PID=$!
for _ in $(seq 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/moto-api/" && break; sleep 0.5; done
curl -fsS -X PUT "http://127.0.0.1:$PORT/test-bucket" -o /dev/null || { echo "could not start fake S3"; exit 2; }

mkdir -p "$WORK/local"
cat > "$WORK/r2.env" <<ENV
R2_ENDPOINT=http://127.0.0.1:$PORT
R2_ACCESS_KEY_ID=TESTKEY
R2_SECRET_ACCESS_KEY=TESTSECRET
R2_BACKUP_BUCKET=test-bucket
R2_BACKUP_PREFIX=db-backups/
ENV
export R2_BACKUP_ENV="$WORK/r2.env" BACKUP_DIR="$WORK/local" INSTALL_DIR="$WORK"

# shellcheck source=../lib-r2.sh
. "$HERE/lib-r2.sh"; r2_load_config_file "$R2_BACKUP_ENV"; r2_require_config
keys() { r2_list_keys | grep -E '^db-backups/iconic_connect_.*\.dump$'; }
t()    { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS + 1)); fi; }
mkdump() { head -c 4096 /dev/urandom > "$WORK/local/iconic_connect_$1.dump"; }   # $1 = timestamp part

# unrelated objects that must never be pruned
curl -fsS -X PUT --data-binary 'x' "http://127.0.0.1:$PORT/test-bucket/db-backups/README.txt" -o /dev/null
curl -fsS -X PUT --data-binary 'x' "http://127.0.0.1:$PORT/test-bucket/app/photo.png" -o /dev/null

mkdump 2026-01-01_020000; "$HERE/backup-to-r2.sh" >/dev/null 2>&1
t "day 1: uploaded"                              '[ "$(keys | wc -l)" = 1 ]'
DAY1="$(keys)"
sleep 1; mkdump 2026-01-02_020000; "$HERE/backup-to-r2.sh" >/dev/null 2>&1
t "day 2: new one uploaded, day 1 deleted"       '[ "$(keys | wc -l)" = 1 ] && [ "$(keys)" != "$DAY1" ] && [ "$(keys)" = "db-backups/iconic_connect_2026-01-02_020000.dump" ]'
t "unrelated objects untouched"                  '[ -n "$(r2_head db-backups/README.txt | cut -d" " -f2)" ] && [ -n "$(r2_head app/photo.png | cut -d" " -f2)" ]'

GOOD="$(keys)"
sleep 1; mkdump 2026-01-03_020000
R2_ENDPOINT=http://127.0.0.1:1 "$HERE/backup-to-r2.sh" >/dev/null 2>&1; rc=$?
t "unreachable R2 → non-zero exit (rc=$rc)"      '[ $rc -ne 0 ]'
t "…and the previous backup is NOT deleted"      '[ "$(keys)" = "$GOOD" ]'
R2_BACKUP_BUCKET=missing "$HERE/backup-to-r2.sh" >/dev/null 2>&1; rc=$?
t "missing bucket → non-zero exit (rc=$rc)"      '[ $rc -ne 0 ]'
t "…and the previous backup is NOT deleted"      '[ "$(keys)" = "$GOOD" ]'

# The scenario that actually proves the ORDER of operations: listing/deleting on R2 would WORK, but the upload
# itself cannot happen (newest dump unreadable). A script that pruned first would have destroyed the good backup.
if [ "$(id -u)" != 0 ]; then
  GOOD="$(keys)"; sleep 1; mkdump 2026-01-03_030000; chmod 000 "$WORK/local/iconic_connect_2026-01-03_030000.dump"
  "$HERE/backup-to-r2.sh" >/dev/null 2>&1; rc=$?
  t "upload impossible but R2 reachable → non-zero exit (rc=$rc)" '[ $rc -ne 0 ]'
  t "…and the previous backup is STILL there (prune did not run first)" '[ "$(keys)" = "$GOOD" ]'
  rm -f "$WORK/local/iconic_connect_2026-01-03_030000.dump"
else
  echo "SKIP upload-impossible scenario (running as root: chmod 000 does not block root)"
fi

sleep 1; mkdump 2026-01-03_040000
R2_KEEP_BACKUPS=2 "$HERE/backup-to-r2.sh" >/dev/null 2>&1
t "env var overrides file: KEEP=2 keeps two"     '[ "$(keys | wc -l)" = 2 ]'
R2_KEEP_BACKUPS=0 "$HERE/backup-to-r2.sh" >/dev/null 2>&1; rc=$?
t "KEEP=0 is rejected (would delete everything)" '[ $rc -ne 0 ] && [ "$(keys | wc -l)" = 2 ]'
out="$(R2_ACCESS_KEY_ID='' "$HERE/backup-to-r2.sh" 2>&1)"; rc=$?
t "missing credentials → exit 2 and a clear message" '[ $rc -eq 2 ] && grep -q "not configured" <<<"$out"'

# encryption round trip
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$WORK/key"
sleep 1; mkdump 2026-01-04_020000
BACKUP_ENCRYPTION_KEY_FILE="$WORK/key" R2_KEEP_BACKUPS=1 "$HERE/backup-to-r2.sh" >/dev/null 2>&1
ENC="$(r2_list_keys | grep -E '\.dump\.enc$' | tail -1)"
t "encrypted object uploaded (.enc)"             '[ -n "$ENC" ]'
r2_get "$ENC" "$WORK/got.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$WORK/key" -in "$WORK/got.enc" -out "$WORK/got.dump"
t "decrypts back to the original dump"           'cmp -s "$WORK/got.dump" "$WORK/local/iconic_connect_2026-01-04_020000.dump"'
t "ciphertext differs from plaintext"            '! cmp -s "$WORK/got.enc" "$WORK/local/iconic_connect_2026-01-04_020000.dump"'

echo; [ "$FAILS" = 0 ] && echo "ALL PASSED" || echo "$FAILS FAILED"
exit "$FAILS"
