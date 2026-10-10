#!/usr/bin/env bash
# Read-only security & health self-check. Exit 1 if anything that must be private is reachable from outside.
# Used at the end of provisioning and by CI; also handy by hand:  sudo /opt/iconic/bin/verify-server.sh
set -uo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/iconic}"
FAIL=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }
skip() { printf '  \033[33mSKIP\033[0m %s\n' "$*"; }

echo "Listening sockets that must be private (Postgres/Redis/Adminer):"
# Anything on these ports bound to something other than loopback is reachable from the network.
PRIVATE_PORTS="${PRIVATE_PORTS:-5432 5433 6379 6380 8080 8081 27017 3306}"
exposed=0
while read -r addr; do
  host="${addr%:*}"; port="${addr##*:}"
  for p in $PRIVATE_PORTS; do
    if [ "$port" = "$p" ]; then
      case "$host" in 127.0.0.1|::1|\[::1\]|localhost) ;; *) fail "port $p is bound to '$host' (reachable from outside!)"; exposed=1;; esac
    fi
  done
done < <(ss -Hltn 2>/dev/null | awk '{print $4}')
[ "$exposed" = 0 ] && pass "no data-service port is exposed beyond loopback"

echo "Containers:"
for c in iconic_postgres iconic_redis; do
  s="$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)"; s="${s:-missing}"
  [ "$s" = "healthy" ] && pass "$c is healthy" || fail "$c is '$s'"
done

echo "Secrets & files:"
if [ -d "$INSTALL_DIR/secrets" ]; then
  [ "$(stat -c %a "$INSTALL_DIR/secrets")" = "700" ] && pass "secrets/ is mode 700" || fail "secrets/ must be mode 700"
  [ "$(stat -c %a "$INSTALL_DIR/connection.env" 2>/dev/null)" = "600" ] && pass "connection.env is mode 600" || fail "connection.env must be mode 600"
  [ "$(stat -c %a "$INSTALL_DIR/redis.conf" 2>/dev/null)" = "400" ] && pass "redis.conf is mode 400" || fail "redis.conf must be mode 400"
else
  skip "no $INSTALL_DIR/secrets (stack not provisioned on this machine)"
fi

echo "Host:"
if command -v ufw >/dev/null 2>&1; then
  ufw status 2>/dev/null | grep -q "Status: active" && pass "ufw is active" || fail "ufw is not active"
else skip "ufw not installed"; fi
if command -v fail2ban-client >/dev/null 2>&1; then
  fail2ban-client status sshd >/dev/null 2>&1 && pass "fail2ban sshd jail running" || fail "fail2ban sshd jail not running"
else skip "fail2ban not installed"; fi

[ "$FAIL" = 0 ] && echo -e "\n\033[32mAll checks passed.\033[0m" || echo -e "\n\033[31mSome checks FAILED.\033[0m"
exit "$FAIL"
