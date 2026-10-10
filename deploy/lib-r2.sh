#!/usr/bin/env bash
# Minimal Cloudflare R2 (S3-compatible) client built on curl's native SigV4 signing — no aws-cli / rclone / SDK to
# install, patch or trust. Sourced by backup-to-r2.sh and restore-from-r2.sh. Needs curl >= 7.76 (Ubuntu 22.04+).
#
# SECURITY: the access key + secret are fed to curl through a config on STDIN (`-K -`), never as arguments, so they
# never show up in `ps`, shell history or /proc/<pid>/cmdline.

# r2_load_config_file <file> — read KEY=VALUE settings from a file, but let variables that are ALREADY set in the
# environment win (so `R2_KEEP_BACKUPS=3 backup-to-r2.sh` overrides the file, as operators expect).
r2_load_config_file() {
  local f="$1" v kv saved=()
  local vars=(R2_ACCOUNT_ID R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BACKUP_BUCKET R2_BACKUP_PREFIX
              R2_KEEP_BACKUPS BACKUP_ENCRYPTION_KEY_FILE HEALTHCHECK_URL)
  [ -r "$f" ] || return 0
  for v in "${vars[@]}"; do [ -n "${!v+x}" ] && saved+=("$v=${!v}"); done
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
  for kv in "${saved[@]}"; do export "${kv%%=*}=${kv#*=}"; done
}

r2_require_config() {
  local v
  for v in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BACKUP_BUCKET; do
    [ -n "${!v:-}" ] || { echo "R2 backup is not configured: $v is empty (see deploy/README.md)" >&2; return 2; }
  done
  [ -n "${R2_ENDPOINT:-}" ] || [ -n "${R2_ACCOUNT_ID:-}" ] || { echo "set R2_ACCOUNT_ID (or R2_ENDPOINT)" >&2; return 2; }
  R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
  R2_BACKUP_PREFIX="${R2_BACKUP_PREFIX:-db-backups/}"
  case "$R2_BACKUP_PREFIX" in */) ;; *) R2_BACKUP_PREFIX="${R2_BACKUP_PREFIX}/";; esac
}

# _r2_curl <curl args…>   (region "auto" is what R2 expects)
_r2_curl() {
  printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" |
    curl -sS -K - --aws-sigv4 "aws:amz:auto:s3" \
      --fail-with-body --retry 3 --retry-delay 5 --retry-connrefused --connect-timeout 20 "$@"
}

_r2_urlenc() { # RFC 3986 percent-encoding
  local s="$1" i c out=""
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in [a-zA-Z0-9.~_-]) out+="$c";; *) out+="$(printf '%%%02X' "'$c")";; esac
  done
  printf '%s' "$out"
}

# r2_put <key> <file>   — verified upload: Content-MD5 makes R2 reject a corrupted body, then we HEAD it back.
r2_put() {
  local key="$1" file="$2" md5hex md5b64 size head_size head_etag
  md5hex="$(md5sum "$file" | cut -d' ' -f1)"
  md5b64="$(openssl md5 -binary "$file" | base64)"
  size="$(stat -c %s "$file")"
  _r2_curl -X PUT -T "$file" \
    -H "Content-MD5: $md5b64" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" -H "Content-Type: application/octet-stream" \
    -o /dev/null "$R2_ENDPOINT/$R2_BACKUP_BUCKET/$key"
  read -r head_size head_etag < <(r2_head "$key")
  if [ "$head_size" != "$size" ] || { [ "${#head_etag}" = 32 ] && [ "$head_etag" != "$md5hex" ]; }; then
    echo "upload verification FAILED for $key (size $head_size vs $size, etag $head_etag vs $md5hex)" >&2
    r2_delete "$key" || true   # never leave a bad object looking like a backup
    return 1
  fi
}

# r2_head <key> → "<size> <etag-without-quotes>"
r2_head() {
  local h; h="$(_r2_curl -I "$R2_ENDPOINT/$R2_BACKUP_BUCKET/$1" | tr -d '\r')"
  printf '%s %s\n' \
    "$(awk 'tolower($1)=="content-length:"{print $2}' <<<"$h")" \
    "$(awk 'tolower($1)=="etag:"{gsub(/"/,"",$2); print $2}' <<<"$h")"
}

r2_get()    { _r2_curl -o "$2" "$R2_ENDPOINT/$R2_BACKUP_BUCKET/$1"; }
r2_delete() { _r2_curl -X DELETE -o /dev/null "$R2_ENDPOINT/$R2_BACKUP_BUCKET/$1"; }

# r2_list_keys → every key under the prefix, one per line, oldest→newest (keys embed a UTC timestamp, so a plain
# lexical sort IS chronological and does not depend on clock skew). Follows pagination.
r2_list_keys() {
  local token="" body url
  {
    while :; do
      url="$R2_ENDPOINT/$R2_BACKUP_BUCKET?list-type=2&max-keys=1000&prefix=$(_r2_urlenc "$R2_BACKUP_PREFIX")"
      [ -n "$token" ] && url+="&continuation-token=$(_r2_urlenc "$token")"
      body="$(_r2_curl "$url")"
      grep -o '<Key>[^<]*</Key>' <<<"$body" | sed 's/<[^>]*>//g' || true
      if grep -q '<IsTruncated>true</IsTruncated>' <<<"$body"; then
        token="$(sed -n 's:.*<NextContinuationToken>\(.*\)</NextContinuationToken>.*:\1:p' <<<"$body")"
        [ -n "$token" ] || break
      else
        break
      fi
    done
  } | sort
}
