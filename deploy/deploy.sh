#!/usr/bin/env bash
# ==============================================================================
# IconicConnect — setup / update on one Ubuntu 24.04 server (run as root)
# Stack: Next.js :4000 (PM2) · Postgres 16 + Redis 7 (Docker, loopback only) · nginx · Let's Encrypt
#
#   ./deploy.sh                                   # first run = setup, afterwards = update
#   ./deploy.sh --update                          # pull, install, migrate, build, reload PM2
#   ./deploy.sh --setup --domain app.example.com --email you@example.com
#   APP_DIR=/root/new_app/IconicConnect ./deploy.sh --update
# ==============================================================================
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/vipinpal70/IconicConnect.git}"
APP_DIR="${APP_DIR:-/root/IconicConnect}"
BRANCH="${BRANCH:-no-supabase-rewrite}"
APP_NAME="iconicconnect"
PORT=4000
COMPOSE="docker compose -f docker-compose.dev.yml"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }
trap 'log_error "Failed at line $LINENO. Nothing after that step was run."' ERR

[ "${EUID:-$(id -u)}" -eq 0 ] || { log_error "Run as root (sudo)."; exit 1; }

UPDATE_ONLY=false; FORCE_SETUP=false; DOMAIN=""; EMAIL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update) UPDATE_ONLY=true ;;
    --setup|--force-setup) FORCE_SETUP=true ;;
    --domain) DOMAIN="$2"; shift ;;
    --email) EMAIL="$2"; shift ;;
    --branch) BRANCH="$2"; shift ;;
    *) log_error "Unknown parameter: $1"; exit 1 ;;
  esac
  shift
done

# Only one deploy at a time (two overlapping runs can collide on migrations / the build).
exec 9>/var/lock/iconicconnect-deploy.lock
flock -n 9 || { log_error "Another deploy is already running (lock: /var/lock/iconicconnect-deploy.lock)."; exit 1; }

is_installed() { [ -d "$APP_DIR/.git" ]; }

setup_swap() {
  local swap; swap=$(free -m | awk '/^Swap:/{print $2}')
  if [ -z "$swap" ] || [ "$swap" -eq 0 ]; then
    log_info "No swap found - creating 2 GB so the build cannot run out of memory..."
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile; mkswap /swapfile >/dev/null; swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  else
    log_info "Swap already configured (${swap} MB)."
  fi
}

install_system() {
  log_info "Installing system packages..."
  apt-get update -y
  apt-get install -y git build-essential nginx certbot python3-certbot-nginx curl ca-certificates nano

  local major=0
  command -v node >/dev/null && major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -lt 22 ]; then
    log_info "Installing Node.js 22 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi

  if ! command -v docker >/dev/null; then
    log_info "Installing Docker (official convenience script)..."
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker

  npm install -g pm2 tsx
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full'; fi
  log_success "System ready (node $(node -v), docker $(docker --version | awk '{print $3}' | tr -d ,), pm2 $(pm2 -v))."
}

get_code() {
  if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    log_info "Fetching $BRANCH..."
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git reset --hard "origin/$BRANCH"        # .env is untracked, so it is never touched
  else
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi
}

check_env() {
  cd "$APP_DIR"
  if [ ! -f .env ]; then
    log_error "$APP_DIR/.env is missing. Copy .env.example to .env, fill it in, then run again."
    exit 1
  fi
  for k in DATABASE_URL REDIS_URL; do
    grep -Eq "^${k}=.+" .env || { log_error "$k is not set in .env"; exit 1; }
  done
  if grep -Eq '^ADMIN_SIGNUP_SECRET=.{0,31}$' .env; then
    log_warning "ADMIN_SIGNUP_SECRET is shorter than 32 characters - the first-admin endpoint stays disabled."
  fi
}

start_databases() {
  cd "$APP_DIR"
  log_info "Starting Postgres + Redis containers (waiting until healthy)..."
  $COMPOSE up -d --wait
  log_success "Postgres and Redis are healthy."
}

build_and_start() {
  cd "$APP_DIR"
  log_info "Installing npm packages..."
  npm ci --include=dev --no-audit --no-fund

  log_info "Applying database migrations (dbmate)..."
  if ! npm run db:up; then
    log_error "Migration failed. Current state:"
    npm run db:status || true
    log_error "Nothing was built or restarted - the running site is untouched. Do NOT reset the database; send the output above."
    exit 1
  fi

  log_info "Building Next.js..."
  npm run build

  log_info "Starting / reloading PM2 processes..."
  pm2 startOrReload ecosystem.config.js --update-env
  pm2 save >/dev/null
}

health_check() {
  local i code
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/api/health" || true)
    if [ "$code" = "200" ]; then log_success "App is healthy on :$PORT (/api/health = 200)."; return 0; fi
    sleep 2
  done
  log_error "App did not become healthy. Check:  pm2 logs iconic-connect-web --lines 50"
  return 1
}

configure_pm2_startup() {
  log_info "Configuring PM2 to start on boot..."
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
  pm2 save >/dev/null
}

configure_nginx() {
  local conf="/etc/nginx/sites-available/$APP_NAME"
  log_info "Writing nginx config for '${DOMAIN:-_}'..."
  [ -f "$conf" ] && cp "$conf" "$conf.bak.$(date +%Y%m%d%H%M%S)"
  cat > "$conf" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN:-_};
    server_tokens off;
    client_max_body_size 5G;

    # Cloudflare real client IP
    real_ip_header CF-Connecting-IP;
    set_real_ip_from 173.245.48.0/20;  set_real_ip_from 103.21.244.0/22;  set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;    set_real_ip_from 141.101.64.0/18;  set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;  set_real_ip_from 188.114.96.0/20;  set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;  set_real_ip_from 162.158.0.0/15;   set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;    set_real_ip_from 172.64.0.0/13;    set_real_ip_from 131.0.72.0/22;
    set_real_ip_from 2400:cb00::/32;   set_real_ip_from 2606:4700::/32;   set_real_ip_from 2803:f800::/32;
    set_real_ip_from 2405:b500::/32;   set_real_ip_from 2405:8100::/32;   set_real_ip_from 2a06:98c0::/29;
    set_real_ip_from 2c0f:f248::/32;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffer_size 256k;
        proxy_buffers 4 512k;
        proxy_busy_buffers_size 512k;
    }

    # Large uploads: stream straight through, long timeouts
    location /api/cases/upload {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
NGINX
  ln -sf "$conf" "/etc/nginx/sites-enabled/$APP_NAME"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  log_success "nginx configured."

  if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect \
      && log_success "HTTPS enabled: https://$DOMAIN" \
      || log_warning "Certbot failed - point the DNS A record at this server, then: certbot --nginx -d $DOMAIN"
  fi
}

do_setup() {
  log_info "=== IconicConnect SETUP ==="
  setup_swap
  install_system
  get_code
  check_env
  start_databases
  build_and_start
  configure_pm2_startup
  configure_nginx
  health_check
  log_success "=== Setup complete. Manage with: pm2 status · pm2 logs ==="
}

do_update() {
  log_info "=== IconicConnect UPDATE ==="
  is_installed || { log_error "$APP_DIR is not a git repository - run the setup first."; exit 1; }
  get_code
  check_env
  start_databases
  build_and_start
  health_check
  log_success "=== Update complete ==="
}

if $FORCE_SETUP; then do_setup
elif $UPDATE_ONLY || is_installed; then do_update
else do_setup
fi
