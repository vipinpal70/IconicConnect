#!/usr/bin/env bash
# Copy the whole app database from one Supabase project to another — public data, the drizzle migration
# journal and the auth users (with their password hashes, so everyone keeps their password).
#
# The OLD project is only READ. Everything that is written goes to the NEW project.
#
#   OLD_DB_URL   session-mode URL of the old project (port 5432). Default: DATABASE_URL from .env with :6543 -> :5432
#   NEW_DB_URL   session-mode URL of the new project (port 5432)   e.g.
#                postgresql://postgres.<newref>:<password>@aws-0-us-west-1.pooler.supabase.com:5432/postgres
#                (type it without leaving the password in your shell history:  read -rs -p "new db password: " PW; echo
#                 export NEW_DB_URL="postgresql://postgres.<newref>:${PW}@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
#
#   bash scripts/migrate-supabase.sh check              compare both projects, change nothing
#   bash scripts/migrate-supabase.sh copy --yes         dump OLD, restore into NEW (NEW must be empty)
#   bash scripts/migrate-supabase.sh copy --yes --wipe-new   same, but first empty the NEW project (use for a re-run)
#   REHEARSAL=1 ...                                     while the site is live, small row-count differences on busy
#                                                       tables are reported but do not fail. The FINAL copy (writes
#                                                       stopped) is run without it and must show zero differences.
#   KEEP_PORT=1 ...                                     do not rewrite 6543 -> 5432 (read OLD through the transaction pooler)
#
# What is NOT copied: auth sessions/refresh tokens (they cannot work with the new project's JWT secret —
# users simply sign in again), Auth dashboard settings, storage files (this project has none).
set -Eeuo pipefail
cd "$(dirname "$0")/.."

ACTION="${1:-}"; shift || true
YES=false; WIPE=false
for a in "$@"; do case "$a" in --yes) YES=true ;; --wipe-new) WIPE=true ;; *) echo "Unknown option $a"; exit 1 ;; esac; done
[ "$ACTION" = "check" ] || [ "$ACTION" = "copy" ] || { sed -n '2,22p' "$0"; exit 1; }

read_env_url() { grep -E '^DATABASE_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }
# Session mode (5432) is needed by pg_dump, but it only has `pool_size` slots in total. If the live app is using them
# all (EMAXCONNSESSION), run with KEEP_PORT=1 and give OLD_DB_URL with port 6543 to read through the transaction pooler.
norm() { if [ "${KEEP_PORT:-0}" = "1" ]; then printf '%s' "$1" | sed -e 's/[?&]pgbouncer=true//'; else printf '%s' "$1" | sed -e 's/:6543\//:5432\//' -e 's/[?&]pgbouncer=true//'; fi; }
mask() { printf '%s' "$1" | sed -E 's#(://[^:]+):[^@]+@#\1:****@#'; }
hostof() { printf '%s' "$1" | sed -E 's#^[a-z]+://[^@]+@([^:/]+).*#\1#'; }
userof() { printf '%s' "$1" | sed -E 's#^[a-z]+://([^:]+):.*#\1#'; }

OLD_URL=$(norm "${OLD_DB_URL:-$(read_env_url)}")
NEW_URL=$(norm "${NEW_DB_URL:-}")
[ -n "$OLD_URL" ] || { echo "OLD_DB_URL is not set and .env has no DATABASE_URL"; exit 1; }
[ -n "$NEW_URL" ] || { echo "NEW_DB_URL is not set (see the header of this script)"; exit 1; }
if [ "$OLD_URL" = "$NEW_URL" ] || [ "$(hostof "$OLD_URL")|$(userof "$OLD_URL")" = "$(hostof "$NEW_URL")|$(userof "$NEW_URL")" ]; then
  echo "OLD and NEW point at the same project — refusing."; exit 1
fi
# A malformed URL (password pasted with the whole connection string, stray quotes, an un-encoded @ # / ? in the
# password...) makes psql fall back to the OS user and fail with confusing errors — catch it up front.
valid_url() {
  [[ "$1" =~ ^postgres(ql)?://[^:@/\"\'[:space:]]+:[^@\"\'[:space:]]+@[A-Za-z0-9.-]+:[0-9]+/[A-Za-z0-9_]+(\?[^\"\'[:space:]]*)?$ ]]
}
for which in OLD NEW; do
  url_var="${which}_URL"
  if ! valid_url "${!url_var}"; then
    echo "The $which database URL is not valid:  $(mask "${!url_var}")"
    if [[ "${!url_var}" =~ ^[a-z]+://[^:@/]+:@ ]]; then
      echo "→ The password is EMPTY (nothing between ':' and '@'). If you pasted several lines at once, the hidden"
      echo "  password prompt may have swallowed or skipped input. Run the 'read' line ALONE, type the password, Enter."
    fi
    echo "It must look like:  postgresql://postgres.<projectref>:<password>@<host>:5432/postgres"
    echo "Common causes: the password prompt got the whole connection string, a stray \" or space, or special characters"
    echo "in the password that are not URL-encoded (@ # / ? : %). Build it like this:"
    echo '   read -rs -p "db password: " PW; echo'
    echo '   ENC=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=\"\"))" "$PW")'
    echo "   export ${which}_DB_URL=\"postgresql://postgres.<projectref>:\${ENC}@<host>:5432/postgres\""
    exit 1
  fi
done
echo "OLD (read only): $(mask "$OLD_URL")"
echo "NEW (written)  : $(mask "$NEW_URL")"

# ---- pick the client tools: local pg 17+ or Docker -------------------------------------------------
LOCAL_MAJOR=$(pg_dump --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
STAMP=$(date +%F-%H%M%S)
OUT="${MIGRATE_OUT:-$HOME/backups/supabase-migrate-$STAMP}"; mkdir -p "$OUT"; chmod 700 "$OUT"
export OLDURL="$OLD_URL" NEWURL="$NEW_URL"
if [ -n "${LOCAL_MAJOR:-}" ] && [ "$LOCAL_MAJOR" -ge 17 ]; then
  PGOUT="$OUT"
  tool() { "$@"; }
else
  command -v docker >/dev/null || { echo "Need pg_dump 17+ or Docker"; exit 1; }
  PGOUT=/out
  tool() { docker run --rm --network host -u "$(id -u):$(id -g)" -e OLDURL -e NEWURL -v "$OUT:/out" postgres:17-alpine "$@"; }
fi
oldsql() { tool sh -c 'psql "$OLDURL" -v ON_ERROR_STOP=1 -X -At "$@"' _ "$@"; }
newsql() { tool sh -c 'psql "$NEWURL" -v ON_ERROR_STOP=1 -X -At "$@"' _ "$@"; }

COUNT_SQL="select 'tables='||(select count(*) from pg_tables where schemaname='public')
 ||' auth_users='||(select count(*) from auth.users)
 ||' auth_identities='||(select count(*) from auth.identities)
 ||' migrations='||coalesce((select count(*) from drizzle.__drizzle_migrations),0);"
safe_new_count() { newsql -c "select 'tables='||(select count(*) from pg_tables where schemaname='public')||' auth_users='||(select count(*) from auth.users)||' auth_identities='||(select count(*) from auth.identities)||' drizzle_schema='||(select count(*) from pg_namespace where nspname='drizzle');"; }

echo; echo "== OLD =="; oldsql -c "$COUNT_SQL"
echo "== NEW =="; safe_new_count

if [ "$ACTION" = "check" ]; then
  echo; echo "Per-table row counts (OLD):"
  oldsql -c "select tablename from pg_tables where schemaname='public' order by 1" | while read -r t; do
    printf '  %-32s %s\n' "$t" "$(oldsql -c "select count(*) from public.\"$t\"")"; done
  echo; echo "Check only — nothing was changed."; exit 0
fi

# ================================ copy ================================
$YES || { echo; echo "This will WRITE to the NEW project. Re-run with --yes to confirm."; exit 1; }

NEW_TABLES=$(newsql -c "select count(*) from pg_tables where schemaname='public'")
NEW_USERS=$(newsql -c "select count(*) from auth.users")
if { [ "$NEW_TABLES" != "0" ] || [ "$NEW_USERS" != "0" ] || [ "$(newsql -c "select count(*) from pg_namespace where nspname='drizzle'")" != "0" ]; } && ! $WIPE; then
  echo; echo "NEW is not empty (tables=$NEW_TABLES, auth users=$NEW_USERS). Use --wipe-new to empty it first (re-run), or use a fresh project."; exit 1
fi

echo; echo "1/5 dumping OLD (read only) ..."
tool sh -c 'pg_dump "$OLDURL" -Fc --no-owner --schema=public --schema=drizzle -f "'"$PGOUT"'/app.dump"'
# auth: users + identities only, as plain COPY data. Generated columns are skipped by pg_dump automatically.
tool sh -c 'pg_dump "$OLDURL" --data-only --no-owner --table=auth.users --table=auth.identities -f "'"$PGOUT"'/auth.sql"'
ls -lh "$OUT" | sed 's/^/   /'

if $WIPE; then
  echo "2/5 emptying NEW (public + drizzle + auth users) ..."
  newsql -c "
    drop schema if exists drizzle cascade;
    drop extension if exists pg_trgm cascade;
    do \$\$ declare r record; begin
      for r in select tablename from pg_tables where schemaname='public' loop execute format('drop table if exists public.%I cascade', r.tablename); end loop;
      for r in select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e' loop execute format('drop type if exists public.%I cascade', r.typname); end loop;
    end \$\$;
    truncate auth.users cascade;" >/dev/null
else
  echo "2/5 NEW is empty — nothing to wipe."
fi

echo "3/5 restoring public + drizzle into NEW (one transaction) ..."
# pg_dump --schema=... does not carry extensions; the file-name search index needs pg_trgm (migration 0052).
newsql -c "create extension if not exists pg_trgm with schema public" >/dev/null
# Keep Supabase's own `public` schema (its grants/ownership); restore only what is inside it.
tool sh -c 'pg_restore -l "'"$PGOUT"'/app.dump" | grep -vE " SCHEMA - public( |\$)" > "'"$PGOUT"'/restore.list"'
tool sh -c 'pg_restore -L "'"$PGOUT"'/restore.list" -d "$NEWURL" --no-owner --single-transaction --exit-on-error "'"$PGOUT"'/app.dump"'

echo "4/5 restoring auth users + identities into NEW ..."
tool sh -c 'psql "$NEWURL" -v ON_ERROR_STOP=1 -X --single-transaction -c "set session_replication_role = replica" -f "'"$PGOUT"'/auth.sql" >/dev/null'

echo "5/5 locking API access (same end state as migration 0056) and verifying ..."
newsql -c "
  do \$\$ declare r record; begin
    for r in select tablename from pg_tables where schemaname='public' loop
      execute format('alter table public.%I enable row level security', r.tablename);
      execute format('revoke all on public.%I from anon, authenticated', r.tablename);
    end loop;
  end \$\$;
  revoke all on all sequences in schema public from anon, authenticated;
  alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
  alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
  grant select on public.profiles to authenticated;
  do \$\$ begin
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_select_own') then
      create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
    end if;
  end \$\$;" >/dev/null

FAIL=0
echo; printf '  %-32s %10s %10s\n' "table" "OLD" "NEW"
while read -r t; do
  o=$(oldsql -c "select count(*) from public.\"$t\""); n=$(newsql -c "select count(*) from public.\"$t\"")
  mark="ok"
  if [ "$o" != "$n" ]; then
    if [ "${REHEARSAL:-0}" = "1" ]; then mark="differs (site is live)"; else mark="MISMATCH"; FAIL=1; fi
  fi
  printf '  %-32s %10s %10s  %s\n' "$t" "$o" "$n" "$mark"
done < <(oldsql -c "select tablename from pg_tables where schemaname='public' order by 1")
for q in "auth.users" "auth.identities" "drizzle.__drizzle_migrations"; do
  o=$(oldsql -c "select count(*) from $q"); n=$(newsql -c "select count(*) from $q")
  mark="ok"
  if [ "$o" != "$n" ]; then
    if [ "${REHEARSAL:-0}" = "1" ]; then mark="differs (site is live)"; else mark="MISMATCH"; FAIL=1; fi
  fi
  printf '  %-32s %10s %10s  %s\n' "$q" "$o" "$n" "$mark"
done
G=$(newsql -c "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')")
echo "  anon/authenticated grants on NEW public: $G (expected 1)"; [ "$G" = "1" ] || FAIL=1
echo "  password hashes copied: $(newsql -c "select count(*) from auth.users where encrypted_password is not null and encrypted_password <> ''") of $(newsql -c "select count(*) from auth.users")"
chmod 600 "$OUT"/* 2>/dev/null || true
echo
if [ "$FAIL" = "0" ]; then echo "Copy verified. Dump files (contain password hashes — keep private): $OUT"
else echo "VERIFICATION FAILED — see MISMATCH lines. The OLD project was not changed."; exit 1; fi
