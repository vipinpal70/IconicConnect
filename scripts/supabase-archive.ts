#!/usr/bin/env tsx
/**
 * ONE-TIME, LOSS-PROOF ARCHIVE OF THE LIVE SUPABASE DATABASE
 * ===========================================================
 *   npx tsx scripts/supabase-archive.ts                 # interactive: shows the inventory, asks you to type the project ref
 *   npx tsx scripts/supabase-archive.ts --yes           # non-interactive
 *
 * What it does (in order — it stops at the first thing that does not check out):
 *   1. Opens Supabase STRICTLY READ-ONLY (BEGIN READ ONLY, REPEATABLE READ = one consistent snapshot of every table,
 *      even if users are active). Nothing is written, updated or deleted in Supabase. Ever.
 *   2. Writes a standard, human-readable SQL archive (schema + every row of every table in auth, public, storage,
 *      realtime, vault, drizzle) — loadable with plain `psql` on any Postgres 15+. It does NOT use pg_dump, so it
 *      works even when your pg_dump is older than the Supabase server (16 vs 17 today).
 *   3. Records, per table: row count + an order-independent checksum of every row (taken from the same snapshot).
 *   4. Restores the archive into a NEW local database (default `supabase_legacy`, in your Docker Postgres) — it
 *      refuses to touch `iconic_connect` or any existing database — and RE-COMPUTES counts + checksums there.
 *      Any difference = the script fails loudly and uploads nothing.
 *   5. Packs everything, encrypts it (AES-256, your ~/.config/iconic/backup_key), uploads ONE copy to Cloudflare R2
 *      under db-backups/supabase-legacy/ (never auto-deleted), then downloads it back, decrypts and compares the
 *      SHA-256 — so the R2 copy is proven restorable, not just "uploaded".
 *
 * Options
 *   --yes                 skip the "type the project ref" confirmation
 *   --target-db <name>    local database to create (default supabase_legacy)
 *   --replace-target      drop and recreate ONLY that target database if it already exists
 *   --no-r2               do everything except the R2 upload
 *   --out-dir <dir>       where the archive is written (default ~/iconic-backups/supabase-legacy)
 *   --schemas a,b,c       schemas to archive (default auth,public,storage,realtime,vault,drizzle)
 *   --key-file <path>     encryption key (default ~/.config/iconic/backup_key; generated if missing)
 *   --ref <project-ref>   Supabase project ref (default: from NEXT_PUBLIC_SUPABASE_URL in .env)
 *
 * Source connection: env SUPABASE_DB_URL, else the commented-out `# DATABASE_URL=…<ref>…` line in .env.
 */
process.env.TZ = 'UTC'

import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'
import postgres from 'postgres'

// ───────────────────────────── args & small helpers ─────────────────────────────
const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const SCHEMAS = (opt('schemas', 'auth,public,storage,realtime,vault,drizzle') as string).split(',').map((s) => s.trim()).filter(Boolean)
const TARGET_DB = opt('target-db', 'supabase_legacy') as string
const OUT_ROOT = opt('out-dir', path.join(os.homedir(), 'iconic-backups', 'supabase-legacy')) as string
const KEY_FILE = opt('key-file', path.join(os.homedir(), '.config', 'iconic', 'backup_key')) as string
const ALLOW_ANY_SOURCE = flag('allow-non-supabase') // self-test hook (source = a local DB); never needed in real use
const SCRIPT_VERSION = '1.0'

const qi = (s: string) => `"${s.replace(/"/g, '""')}"`            // quote identifier
const ql = (s: string) => `'${s.replace(/'/g, "''")}'`            // quote literal
const log = (m: string) => console.log(m)
const step = (m: string) => console.log(`\n\x1b[1;34m▶ ${m}\x1b[0m`)
const ok = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`)
const warn = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`)
const die = (m: string): never => { console.error(`\n\x1b[31m✖ ${m}\x1b[0m`); process.exit(1) }

function envFileValue(file: string, key: string): string | undefined {
  if (!fs.existsSync(file)) return undefined
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`))
  return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
}

// ───────────────────────────── 0. resolve connections (read-only source, local target) ─────────────────────────────
function resolveSource(): { url: string; ref: string } {
  let url = process.env.SUPABASE_DB_URL
  let ref = opt('ref') ?? (envFileValue('.env', 'NEXT_PUBLIC_SUPABASE_URL') ?? '').replace(/^https?:\/\/([^.]+)\..*$/, '$1')
  if (!url) {
    const lines = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').split('\n') : []
    const found = lines.find((l) => /^#?\s*DATABASE_URL=/.test(l) && ref && l.includes(ref))
    if (found) url = found.replace(/^#?\s*DATABASE_URL=/, '').trim()
  }
  if (!url) die(`Could not find the Supabase connection string. Export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres' and re-run.`)
  const u = new URL(url!)
  if (!ALLOW_ANY_SOURCE && !/supabase\.(com|co)$/.test(u.hostname)) die(`Source host "${u.hostname}" is not a Supabase host — refusing (use --allow-non-supabase only for self-tests).`)
  if (!ref) ref = decodeURIComponent(u.username).split('.')[1] ?? u.hostname
  // pg needs session semantics for a long consistent snapshot: use the session pooler (5432) instead of the transaction pooler (6543)
  if (u.port === '6543') u.port = '5432'
  return { url: u.toString(), ref }
}

function resolveLocal(): { adminUrl: string; urlFor: (db: string) => string; container: string; user: string; port: string } {
  const raw = envFileValue('.env', 'DATABASE_URL') ?? die('no DATABASE_URL in .env')
  const u = new URL(raw)
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) die(`Local target must be localhost; .env DATABASE_URL points at "${u.hostname}". Refusing.`)
  const container = execFileSync('docker', ['ps', '--filter', `publish=${u.port}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split('\n')[0]
  if (!container) die(`No running Docker container publishes port ${u.port}. Start your local Postgres first.`)
  const mk = (db: string) => { const x = new URL(raw); x.pathname = `/${db}`; x.search = '?sslmode=disable'; return x.toString() }
  return { adminUrl: mk('postgres'), urlFor: mk, container, user: decodeURIComponent(u.username), port: u.port }
}

// ───────────────────────────── 1. catalog → DDL (server-side pg_get_*def, version independent) ─────────────────────────────
type Sql = postgres.TransactionSql
type Row = Record<string, any>

const SKIP_EXTENSIONS = new Set(['plpgsql', 'supabase_vault', 'pg_stat_statements', 'pg_graphql', 'pg_net', 'pgsodium', 'pgjwt', 'pg_cron', 'wrappers', 'pgaudit', 'pg_stat_monitor', 'vector_dummy'])

async function inventory(tx: Sql, schemas: string[]) {
  const tables = await tx<Row[]>`
    select c.oid::int as oid, n.nspname as schema, c.relname as name, c.relkind, c.relpersistence,
           c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any(${schemas}) and c.relkind in ('r','p') and not c.relispartition
     order by n.nspname, c.relname`
  const cols = await tx<Row[]>`
    select a.attrelid::int as relid, a.attnum, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull, a.attgenerated, a.attidentity,
           pg_get_expr(d.adbin, d.adrelid) as default_expr,
           case when a.attcollation <> t.typcollation then (select quote_ident(cn.nspname)||'.'||quote_ident(co.collname) from pg_collation co join pg_namespace cn on cn.oid=co.collnamespace where co.oid=a.attcollation) end as collation
      from pg_attribute a
      join pg_type t on t.oid = a.atttypid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = any(${tables.map((t) => t.oid)}) and a.attnum > 0 and not a.attisdropped
     order by a.attrelid, a.attnum`
  return { tables, cols }
}

async function buildSchemaParts(tx: Sql, schemas: string[]) {
  await tx.unsafe(`set local search_path = ''`)                // forces schema-qualified output from every pg_get_*def()
  const { tables, cols } = await inventory(tx, schemas)
  const tableIds = tables.map((t) => t.oid)
  const tname = (t: Row) => `${qi(t.schema)}.${qi(t.name)}`
  const byOid = new Map(tables.map((t) => [t.oid, t]))

  // extensions (only those that exist as non-skipped; created IF AVAILABLE on restore)
  const exts = await tx<Row[]>`select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1`
  const extSchemas = new Set<string>()
  const extSql: string[] = []
  for (const e of exts) {
    if (SKIP_EXTENSIONS.has(e.extname)) continue
    extSchemas.add(e.nspname)
    extSql.push(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = ${ql(e.extname)}) THEN CREATE EXTENSION IF NOT EXISTS ${qi(e.extname)} WITH SCHEMA ${qi(e.nspname)}; END IF; END $$;`)
  }
  const schemaSql = [...new Set([...schemas, ...extSchemas])].filter((s) => s !== 'public').map((s) => `CREATE SCHEMA IF NOT EXISTS ${qi(s)};`)

  // roles referenced by RLS policies must exist (NOLOGIN placeholders; no privileges are restored)
  const polRoles = tableIds.length ? await tx<Row[]>`select distinct r.rolname from pg_policy p cross join lateral unnest(p.polroles) as u(oid) join pg_roles r on r.oid = u.oid where p.polrelid = any(${tableIds}) and u.oid <> 0` : []
  const roleSql = polRoles.map((r) => `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${ql(r.rolname)}) THEN CREATE ROLE ${qi(r.rolname)} NOLOGIN; END IF; END $$;`)

  // types: enums, domains, composites (extension-owned types excluded)
  const notExt = (oidCol: string, classId: string) => `not exists (select 1 from pg_depend d where d.objid = ${oidCol} and d.classid = '${classId}'::regclass and d.deptype = 'e')`
  const enums = await tx.unsafe<Row[]>(`
    select n.nspname as schema, t.typname as name, (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) as labels
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where t.typtype = 'e' and n.nspname = any($1) and ${notExt('t.oid', 'pg_type')} order by 1,2`, [schemas])
  const domains = await tx.unsafe<Row[]>(`
    select n.nspname as schema, t.typname as name, format_type(t.typbasetype, t.typtypmod) as base, t.typnotnull, pg_get_expr(t.typdefaultbin, 0) as dflt,
           (select json_agg(pg_get_constraintdef(c.oid)) from pg_constraint c where c.contypid = t.oid) as checks
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where t.typtype = 'd' and n.nspname = any($1) and ${notExt('t.oid', 'pg_type')} order by 1,2`, [schemas])
  const composites = await tx.unsafe<Row[]>(`
    select n.nspname as schema, t.typname as name,
           (select json_agg(json_build_object('n', a.attname, 't', format_type(a.atttypid, a.atttypmod)) order by a.attnum) from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) as attrs
      from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_class c on c.oid = t.typrelid
     where t.typtype = 'c' and c.relkind = 'c' and n.nspname = any($1) and ${notExt('t.oid', 'pg_type')} order by 1,2`, [schemas])
  const typeSql = [
    ...enums.map((e) => `CREATE TYPE ${qi(e.schema)}.${qi(e.name)} AS ENUM (${(e.labels as string[]).map(ql).join(', ')});`),
    ...domains.map((d) => `CREATE DOMAIN ${qi(d.schema)}.${qi(d.name)} AS ${d.base}${d.dflt ? ` DEFAULT ${d.dflt}` : ''}${d.typnotnull ? ' NOT NULL' : ''}${(d.checks ?? []).map((c: string) => ` ${c}`).join('')};`),
    ...composites.map((c) => `CREATE TYPE ${qi(c.schema)}.${qi(c.name)} AS (${(c.attrs as Array<{ n: string; t: string }>).map((a) => `${qi(a.n)} ${a.t}`).join(', ')});`),
  ]

  // standalone / owned sequences (identity sequences are created by the identity column itself)
  const seqs = await tx<Row[]>`
    select n.nspname as schema, c.relname as name, format_type(s.seqtypid, null) as type, s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle,
           (select d.deptype from pg_depend d where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a','i') limit 1) as owner_kind,
           (select d.refobjid::int from pg_depend d where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a','i') limit 1) as owner_table,
           (select d.refobjsubid from pg_depend d where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a','i') limit 1) as owner_col
      from pg_sequence s join pg_class c on c.oid = s.seqrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any(${schemas}) order by 1,2`
  const seqCreate: string[] = []
  const seqOwn: string[] = []
  const seqSetval: string[] = []
  const colName = (relid: number, attnum: number) => cols.find((c) => c.relid === relid && c.attnum === attnum)?.name
  for (const s of seqs) {
    const full = `${qi(s.schema)}.${qi(s.name)}`
    const cur = (await tx.unsafe<Row[]>(`select last_value, is_called from ${full}`))[0]
    if (s.owner_kind !== 'i') {
      seqCreate.push(`CREATE SEQUENCE ${full} AS ${s.type} INCREMENT BY ${s.seqincrement} MINVALUE ${s.seqmin} MAXVALUE ${s.seqmax} START WITH ${s.seqstart} CACHE ${s.seqcache}${s.seqcycle ? ' CYCLE' : ' NO CYCLE'};`)
      const t = s.owner_table ? byOid.get(s.owner_table) : undefined
      if (s.owner_kind === 'a' && t) seqOwn.push(`ALTER SEQUENCE ${full} OWNED BY ${tname(t)}.${qi(colName(t.oid, s.owner_col)!)};`)
      seqSetval.push(`SELECT pg_catalog.setval(${ql(full)}, ${cur.last_value}, ${cur.is_called});`)
    } else {
      const t = byOid.get(s.owner_table)
      if (t) seqSetval.push(`SELECT pg_catalog.setval(pg_get_serial_sequence(${ql(tname(t))}, ${ql(colName(t.oid, s.owner_col)!)}), ${cur.last_value}, ${cur.is_called});`)
    }
  }

  // functions (non-extension), written tolerantly: bodies are not validated at creation
  const funcs = await tx.unsafe<Row[]>(`
    select pg_get_functiondef(p.oid) as def, n.nspname as schema, p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any($1) and p.prokind in ('f','p') and ${notExt('p.oid', 'pg_proc')} order by 2,3, p.oid`, [schemas])

  // Defaults that call functions of an extension we deliberately do not install locally (e.g. supabase_vault's
  // vault._crypto_aead_det_noncegen()) cannot be recreated. Every existing row already carries its value, so only the
  // DEFAULT clause is omitted — no data is affected. Each omission is recorded in the manifest.
  const skippedFns = await tx<Row[]>`
    select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join pg_depend d on d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      join pg_extension e on e.oid = d.refobjid where e.extname = any(${[...SKIP_EXTENSIONS]})`
  const droppedDefaults: string[] = []
  const unavailable = (expr: string | null) => !!expr && skippedFns.some((f) => expr.includes(`${f.nspname}.${f.proname}(`) || expr.includes(`${qi(f.nspname)}.${qi(f.proname)}(`))

  // tables
  const colsOf = (t: Row) => cols.filter((c) => c.relid === t.oid)
  const tableSql = tables.map((t) => {
    const body = colsOf(t).map((c) => {
      let s = `    ${qi(c.name)} ${c.type}`
      if (c.collation) s += ` COLLATE ${c.collation}`
      if (c.attgenerated === 's') s += ` GENERATED ALWAYS AS (${c.default_expr}) STORED`
      else if (c.attidentity === 'a') s += ' GENERATED ALWAYS AS IDENTITY'
      else if (c.attidentity === 'd') s += ' GENERATED BY DEFAULT AS IDENTITY'
      else if (c.default_expr && unavailable(c.default_expr)) droppedDefaults.push(`${t.schema}.${t.name}.${c.name}: ${c.default_expr}`)
      else if (c.default_expr) s += ` DEFAULT ${c.default_expr}`
      if (c.attnotnull) s += ' NOT NULL'
      return s
    }).join(',\n')
    return `CREATE ${t.relpersistence === 'u' ? 'UNLOGGED ' : ''}TABLE ${tname(t)} (\n${body}\n);`
  })

  // constraints (after data), indexes, triggers, RLS
  const cons = tableIds.length ? await tx<Row[]>`
    select c.conrelid::int as relid, c.conname, c.contype, pg_get_constraintdef(c.oid) as def
      from pg_constraint c where c.conrelid = any(${tableIds}) and c.conparentid = 0 and c.contype in ('p','u','c','f','x')
     order by case c.contype when 'p' then 1 when 'u' then 2 when 'x' then 2 when 'c' then 3 else 4 end, c.conrelid, c.conname` : []
  const conSql = cons.map((c) => `ALTER TABLE ONLY ${tname(byOid.get(c.relid)!)} ADD CONSTRAINT ${qi(c.conname)} ${c.def};`)
  const idx = tableIds.length ? await tx<Row[]>`
    select pg_get_indexdef(i.indexrelid) as def, i.indrelid::int as relid
      from pg_index i
     where i.indrelid = any(${tableIds}) and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
     order by 2, i.indexrelid` : []
  const idxSql = idx.map((i) => `${i.def};`)
  const trg = tableIds.length ? await tx<Row[]>`select pg_get_triggerdef(t.oid) as def from pg_trigger t where t.tgrelid = any(${tableIds}) and not t.tgisinternal order by t.tgrelid, t.tgname` : []
  const trgSql = trg.map((t) => `${t.def};`)
  const rls: string[] = []
  for (const t of tables) {
    if (t.relrowsecurity) rls.push(`ALTER TABLE ${tname(t)} ENABLE ROW LEVEL SECURITY;`)
    if (t.relforcerowsecurity) rls.push(`ALTER TABLE ${tname(t)} FORCE ROW LEVEL SECURITY;`)
  }
  const pols = tableIds.length ? await tx<Row[]>`
    select p.polrelid::int as relid, p.polname, p.polcmd, p.polpermissive,
           (select coalesce(string_agg(case when u.oid = 0 then 'PUBLIC' else quote_ident((select rolname from pg_roles where oid = u.oid)) end, ', '), 'PUBLIC') from unnest(p.polroles) as u(oid)) as roles,
           pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as withcheck
      from pg_policy p where p.polrelid = any(${tableIds}) order by 1, 2` : []
  const cmdName: Record<string, string> = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' }
  const polSql = pols.map((p) => `CREATE POLICY ${qi(p.polname)} ON ${tname(byOid.get(p.relid)!)} AS ${p.polpermissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${cmdName[p.polcmd]} TO ${p.roles}${p.qual ? ` USING (${p.qual})` : ''}${p.withcheck ? ` WITH CHECK (${p.withcheck})` : ''};`)

  // views / materialized views (extension-owned skipped); created after data so MV WITH DATA is meaningful
  const views = await tx.unsafe<Row[]>(`
    select n.nspname as schema, c.relname as name, c.relkind, pg_get_viewdef(c.oid, true) as def, c.reloptions
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('v','m') and n.nspname = any($1) and ${notExt('c.oid', 'pg_class')} order by c.relkind desc, 1, 2`, [schemas])
  const viewSql = views.map((v) => `CREATE ${v.relkind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW'} ${qi(v.schema)}.${qi(v.name)}${v.reloptions?.length ? ` WITH (${(v.reloptions as string[]).join(', ')})` : ''} AS\n${String(v.def).replace(/;\s*$/, '')}${v.relkind === 'm' ? '\nWITH DATA' : ''};`)

  const header = [
    `-- Archive of Supabase database, generated by scripts/supabase-archive.ts v${SCRIPT_VERSION}`,
    `SET statement_timeout = 0; SET lock_timeout = 0; SET client_encoding = 'UTF8'; SET standard_conforming_strings = on;`,
    `SET check_function_bodies = off; SET row_security = off; SET search_path = '';`,
    `SET TimeZone = 'UTC';`,
  ]
  const core = [
    ...header, '', '-- schemas & extensions', ...schemaSql, ...extSql,
    '', '-- roles referenced by policies', ...roleSql,
    '', '-- types', ...typeSql,
    '', '-- sequences', ...seqCreate,
    '', '-- functions (tolerant: bodies unchecked)', ...funcs.map((f) => `${String(f.def).trim()};`),
    '', '-- tables', ...tableSql,
  ]
  const afterData = [
    ...header, '', '-- sequence ownership & current values', ...seqOwn, ...seqSetval,
    '', '-- constraints (PK/unique first, FKs last)', ...conSql,
    '', '-- indexes', ...idxSql,
  ]
  const extras = [...header, '', '-- triggers', ...trgSql, '', '-- views', ...viewSql, '', '-- row level security', ...rls, ...polSql]
  return { tables, cols, core, afterData, extras, droppedDefaults, counts: { enums: enums.length, domains: domains.length, composites: composites.length, sequences: seqs.length, functions: funcs.length, constraints: cons.length, indexes: idx.length, triggers: trg.length, views: views.length, policies: pols.length } }
}

// ───────────────────────────── 2. data export (COPY, one snapshot) ─────────────────────────────
function openGzip(file: string) {
  const gz = zlib.createGzip({ level: 9 })
  const out = fs.createWriteStream(file, { mode: 0o600 })
  gz.pipe(out)
  return {
    async write(s: string | Buffer) { if (!gz.write(s)) await once(gz, 'drain') },
    async close() { gz.end(); await once(out, 'finish') },
  }
}

const CHECKSUM_SESSION = ["set local timezone = 'UTC'", "set local datestyle = 'ISO, MDY'", "set local intervalstyle = 'postgres'", 'set local extra_float_digits = 3', "set local bytea_output = 'hex'"]
async function tableFingerprint(tx: Sql, schema: string, name: string): Promise<{ rows: number; md5: string }> {
  const r = (await tx.unsafe<Row[]>(`select count(*)::bigint as n, md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), '')) as h from ${qi(schema)}.${qi(name)} t`))[0]
  return { rows: Number(r.n), md5: r.h }
}
async function structureCounts(tx: Sql, schema: string, name: string) {
  const r = (await tx.unsafe<Row[]>(`
    select (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)::int as columns,
           (select count(*) from pg_index i where i.indrelid = c.oid)::int as indexes,
           (select count(*) from pg_constraint k where k.conrelid = c.oid and k.conparentid = 0 and k.contype in ('p','u','c','f','x'))::int as constraints
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2`, [schema, name]))[0]
  return { columns: r.columns as number, indexes: r.indexes as number, constraints: r.constraints as number }
}

// ───────────────────────────── helpers: local restore via psql in the container ─────────────────────────────
function psqlRun(container: string, user: string, db: string, input: Buffer | string, stopOnError: boolean): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`, '-U', user, '-d', db], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('error', reject)
    p.on('close', (code) => resolve({ code: code ?? 1, stderr }))
    p.stdin.end(input)
  })
}
const gunzipFile = (f: string) => zlib.gunzipSync(fs.readFileSync(f))
const sha256File = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

// ───────────────────────────── main ─────────────────────────────
async function main() {
  const t0 = Date.now()
  const src = resolveSource()
  const local = resolveLocal()
  if (/^(iconic_connect|postgres|template0|template1)$/i.test(TARGET_DB)) die(`Refusing to use "${TARGET_DB}" as the restore target. Pick a NEW name (default supabase_legacy).`)
  if (!/^[a-z_][a-z0-9_]*$/.test(TARGET_DB)) die('--target-db must be a simple lowercase identifier')

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z')
  const archiveName = `supabase-${src.ref}-${stamp}`
  const outDir = path.join(OUT_ROOT, archiveName)
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 })

  console.log(`\n\x1b[1mSupabase → local archive\x1b[0m   (READ-ONLY on Supabase; nothing there is ever modified)`)
  log(`source   : project ${src.ref}  (${new URL(src.url).hostname})`)
  log(`local    : container ${local.container} (port ${local.port}) → NEW database "${TARGET_DB}"`)
  log(`archive  : ${outDir}`)

  // ── 1. consistent read-only snapshot ──
  const sql = postgres(src.url, { max: 1, prepare: false, connect_timeout: 30, idle_timeout: 0, max_lifetime: null, onnotice: () => {} })
  const manifest: Record<string, any> = { script: `supabase-archive.ts v${SCRIPT_VERSION}`, project_ref: src.ref, created_at: new Date().toISOString(), schemas: SCHEMAS, tables: {} }

  try {
    await sql.begin('isolation level repeatable read read only', async (tx) => {
      const ro = (await tx`show transaction_read_only`)[0].transaction_read_only
      if (ro !== 'on') die('Safety check failed: the source session is NOT read-only. Aborting before reading anything.')
      const ver = (await tx`show server_version`)[0].server_version as string
      manifest.source_server_version = ver
      step(`Snapshot of Supabase (Postgres ${ver}) — read-only, consistent`)
      ok('session verified read-only (transaction_read_only = on)')

      const parts = await buildSchemaParts(tx, SCHEMAS)
      const hasAuth = (await tx`select to_regclass('auth.users') is not null as ok`)[0].ok   // (a failed query would abort the whole transaction)
      const user = hasAuth ? (await tx`select count(*)::int n from auth.users`)[0].n : 0
      log(`  schemas: ${SCHEMAS.join(', ')}  |  ${parts.tables.length} tables  |  auth.users = ${user}`)
      log(`  objects: ${JSON.stringify(parts.counts)}`)

      // Row counts (cheap) for the confirmation screen
      const quick: Array<{ t: string; n: number }> = []
      for (const t of parts.tables) quick.push({ t: `${t.schema}.${t.name}`, n: Number((await tx.unsafe<Row[]>(`select count(*)::bigint n from ${qi(t.schema)}.${qi(t.name)}`))[0].n) })
      const total = quick.reduce((a, b) => a + b.n, 0)
      log(`  ${total} rows in total. Largest: ${quick.sort((a, b) => b.n - a.n).slice(0, 5).map((q) => `${q.t}=${q.n}`).join(', ')}`)

      if (!flag('yes')) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const ans = (await rl.question(`\nThis will READ project "${src.ref}" and create local database "${TARGET_DB}". Type the project ref to continue: `)).trim()
        rl.close()
        if (ans !== src.ref) die('Confirmation did not match — nothing was done.')
      }
      for (const s of CHECKSUM_SESSION) await tx.unsafe(s)

      // ── 2. write the archive ──
      step('Writing SQL archive (schema + every row)')
      const core = openGzip(path.join(outDir, '01_schema.sql.gz'))
      await core.write(parts.core.join('\n') + '\n')
      await core.close()

      const data = openGzip(path.join(outDir, '02_data.sql.gz'))
      await data.write(`SET statement_timeout = 0; SET client_encoding = 'UTF8'; SET standard_conforming_strings = on; SET search_path = ''; SET TimeZone = 'UTC';\n`)
      for (const t of parts.tables) {
        const names = parts.cols.filter((c) => c.relid === t.oid && c.attgenerated !== 's').map((c) => qi(c.name))
        const fq = `${qi(t.schema)}.${qi(t.name)}`
        await data.write(`\nCOPY ${fq} (${names.join(', ')}) FROM stdin;\n`)
        const stream = await tx.unsafe(`COPY (SELECT ${names.join(', ')} FROM ${fq}) TO STDOUT`).readable()
        for await (const chunk of stream) await data.write(chunk as Buffer)
        await data.write('\\.\n')
        const fp = await tableFingerprint(tx, t.schema, t.name)
        const st = await structureCounts(tx, t.schema, t.name)
        manifest.tables[`${t.schema}.${t.name}`] = { ...fp, ...st }
      }
      await data.close()

      const after = openGzip(path.join(outDir, '03_constraints_indexes.sql.gz'))
      await after.write(parts.afterData.join('\n') + '\n'); await after.close()
      const extras = openGzip(path.join(outDir, '04_triggers_views_policies.sql.gz'))
      await extras.write(parts.extras.join('\n') + '\n'); await extras.close()
      manifest.object_counts = parts.counts
      manifest.omitted_defaults = parts.droppedDefaults   // DEFAULT clauses (not data) that depend on extensions not installed locally
      if (parts.droppedDefaults.length) warn(`omitted ${parts.droppedDefaults.length} column DEFAULT(s) that need Supabase-only extension functions (data unaffected)`)
      manifest.total_rows = Object.values(manifest.tables).reduce((a: number, t: any) => a + t.rows, 0)
      ok(`${parts.tables.length} tables, ${manifest.total_rows} rows written; fingerprints taken from the SAME snapshot`)
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
  ok('Supabase connection closed — nothing was written to it')

  // ── 3. restore into a NEW local database ──
  step(`Restoring into local database "${TARGET_DB}"`)
  const admin = postgres(local.adminUrl, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const exists = (await admin`select 1 from pg_database where datname = ${TARGET_DB}`).length > 0
    if (exists && !flag('replace-target')) die(`Local database "${TARGET_DB}" already exists. Re-run with --replace-target to drop and recreate THAT database only (iconic_connect is never touched).`)
    if (exists) { await admin.unsafe(`drop database ${qi(TARGET_DB)} with (force)`); warn(`dropped existing ${TARGET_DB}`) }
    await admin.unsafe(`create database ${qi(TARGET_DB)}`)
  } finally { await admin.end() }
  ok(`created ${TARGET_DB}`)

  const phases: Array<[string, string, boolean]> = [
    ['schema', '01_schema.sql.gz', true], ['data', '02_data.sql.gz', true], ['constraints+indexes', '03_constraints_indexes.sql.gz', true], ['triggers/views/policies', '04_triggers_views_policies.sql.gz', false],
  ]
  const extraErrors: string[] = []
  for (const [label, file, strict] of phases) {
    const r = await psqlRun(local.container, local.user, TARGET_DB, gunzipFile(path.join(outDir, file)), strict)
    if (strict && r.code !== 0) die(`Restore phase "${label}" FAILED:\n${r.stderr.split('\n').slice(0, 12).join('\n')}\n\nThe local database "${TARGET_DB}" was left in place for inspection. NOTHING was uploaded.`)
    if (!strict && r.stderr.trim()) extraErrors.push(...r.stderr.trim().split('\n').filter((l) => /ERROR/.test(l)))
    ok(`${label}${strict ? '' : extraErrors.length ? ` (${extraErrors.length} tolerated error(s))` : ''}`)
  }
  manifest.restore_tolerated_errors = extraErrors

  // ── 4. PROVE zero loss: recompute everything on the restored copy ──
  step('Verifying the restored copy against the Supabase snapshot')
  const verifier = postgres(local.urlFor(TARGET_DB), { max: 1, prepare: false, onnotice: () => {} })
  const problems: string[] = []
  try {
    await verifier.begin(async (tx) => {
      for (const s of CHECKSUM_SESSION) await tx.unsafe(s)
      for (const [full, want] of Object.entries<any>(manifest.tables)) {
        const [schema, ...rest] = full.split('.'); const name = rest.join('.')
        const got = await tableFingerprint(tx, schema, name)
        const st = await structureCounts(tx, schema, name)
        if (got.rows !== want.rows) problems.push(`${full}: ROW COUNT ${got.rows} ≠ ${want.rows}`)
        else if (got.md5 !== want.md5) problems.push(`${full}: CONTENT CHECKSUM differs (counts match)`)
        for (const k of ['columns', 'indexes', 'constraints'] as const) if (st[k] !== want[k]) problems.push(`${full}: ${k} ${st[k]} ≠ ${want[k]} (structure)`)
      }
    })
  } finally { await verifier.end() }
  if (problems.length) {
    problems.forEach((p) => console.error(`  \x1b[31m✖\x1b[0m ${p}`))
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ ...manifest, verification: 'FAILED', problems }, null, 2))
    die(`VERIFICATION FAILED (${problems.length} problem(s)). Nothing was uploaded to R2. Archive kept in ${outDir} for investigation.`)
  }
  manifest.verification = 'PASSED'
  ok(`all ${Object.keys(manifest.tables).length} tables identical: row counts + content checksums + columns/indexes/constraints`)
  const authUsers = manifest.tables['auth.users']
  if (authUsers) ok(`auth.users: ${authUsers.rows} users, checksum ${authUsers.md5.slice(0, 12)}… identical (includes password hashes)`)

  // ── 5. package, encrypt, upload, re-download, compare ──
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  fs.writeFileSync(path.join(outDir, 'RESTORE.txt'), restoreHelp(archiveName), { mode: 0o600 })
  step('Packaging')
  const tarball = path.join(OUT_ROOT, `${archiveName}.tar.gz`)
  execFileSync('tar', ['-czf', tarball, '-C', OUT_ROOT, archiveName])
  fs.chmodSync(tarball, 0o600)
  const tarSha = sha256File(tarball)
  ok(`${path.basename(tarball)}  ${(fs.statSync(tarball).size / 1024).toFixed(0)} KB  sha256 ${tarSha.slice(0, 16)}…`)

  if (flag('no-r2')) { warn('--no-r2: skipping the R2 upload'); return summary(outDir, tarball, null, t0) }

  step('Encrypting and uploading to Cloudflare R2')
  if (!fs.existsSync(KEY_FILE) || fs.statSync(KEY_FILE).size === 0) {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true }); fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600 })
    warn(`generated a new encryption key at ${KEY_FILE} — COPY IT somewhere safe; the R2 archive cannot be decrypted without it`)
  }
  const enc = `${tarball}.enc`
  execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-iter', '600000', '-salt', '-pass', `file:${KEY_FILE}`, '-in', tarball, '-out', enc])
  fs.chmodSync(enc, 0o600)

  const { PutObjectCommand, HeadObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3')
  const { S3Client } = await import('@aws-sdk/client-s3')
  const e = (k: string) => envFileValue('.env', k) ?? die(`${k} missing in .env`)
  const r2 = new S3Client({ region: 'auto', endpoint: `https://${e('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`, credentials: { accessKeyId: e('R2_ACCESS_KEY_ID'), secretAccessKey: e('R2_SECRET_ACCESS_KEY') }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' })
  const bucket = e('R2_BUCKET')
  const key = `db-backups/supabase-legacy/${path.basename(enc)}`
  const body = fs.readFileSync(enc)
  const md5b64 = crypto.createHash('md5').update(body).digest('base64')
  await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentMD5: md5b64, ContentType: 'application/octet-stream', Metadata: { sha256_of_tarball: tarSha, project: src.ref } }))
  const head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  if (head.ContentLength !== body.length) die(`R2 object size ${head.ContentLength} ≠ local ${body.length}. Upload NOT trusted.`)
  ok(`uploaded r2://${bucket}/${key}  (${(body.length / 1024).toFixed(0)} KB, size + MD5 verified by R2)`)
  const manifestKey = `db-backups/supabase-legacy/${archiveName}.manifest.json`
  await r2.send(new PutObjectCommand({ Bucket: bucket, Key: manifestKey, Body: fs.readFileSync(path.join(outDir, 'manifest.json')), ContentType: 'application/json' }))
  ok(`uploaded the (data-free) manifest next to it: ${path.basename(manifestKey)}`)

  step('Proving the R2 copy is restorable (download → decrypt → compare SHA-256)')
  const got = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const dl = path.join(os.tmpdir(), `r2check-${process.pid}.enc`)
  await pipeline(got.Body as NodeJS.ReadableStream, fs.createWriteStream(dl, { mode: 0o600 }))
  const dec = `${dl}.tar.gz`
  execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '600000', '-pass', `file:${KEY_FILE}`, '-in', dl, '-out', dec])
  const roundTrip = sha256File(dec)
  fs.rmSync(dl, { force: true }); fs.rmSync(dec, { force: true }); fs.rmSync(enc, { force: true })
  if (roundTrip !== tarSha) die(`R2 round-trip checksum MISMATCH (${roundTrip} ≠ ${tarSha}). Do not rely on the R2 copy!`)
  ok('downloaded from R2, decrypted with your key, SHA-256 identical to the local archive')
  return summary(outDir, tarball, `r2://${bucket}/${key}`, t0)
}

function restoreHelp(name: string) {
  return `RESTORE INSTRUCTIONS — ${name}
=================================================
Contents (each file is gzip-compressed standard SQL; loads with plain psql on Postgres 15+):
  01_schema.sql.gz               schemas, types, sequences, functions, tables
  02_data.sql.gz                 every row (COPY blocks)
  03_constraints_indexes.sql.gz  primary/unique/check/foreign keys, indexes, sequence values
  04_triggers_views_policies.sql.gz  triggers, views, row-level-security (errors here are tolerable)
  manifest.json                  per-table row counts + content checksums taken at export time

Restore into any EMPTY database:
  createdb legacy
  for f in 01_schema 02_data 03_constraints_indexes; do gunzip -c $f.sql.gz | psql -X -v ON_ERROR_STOP=1 -d legacy; done
  gunzip -c 04_triggers_views_policies.sql.gz | psql -X -d legacy        # optional, tolerant

From R2 (encrypted):
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:$HOME/.config/iconic/backup_key -in ${name}.tar.gz.enc -out ${name}.tar.gz
  tar -xzf ${name}.tar.gz
`
}

function summary(outDir: string, tarball: string, r2key: string | null, t0: number) {
  console.log(`\n\x1b[1;32m════════ DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s — nothing was lost ════════\x1b[0m`)
  log(`local database : ${TARGET_DB}  (inspect with: docker exec -it <container> psql -U postgres -d ${TARGET_DB})`)
  log(`archive folder : ${outDir}`)
  log(`archive tarball: ${tarball}`)
  log(`R2 copy        : ${r2key ?? '(skipped)'}`)
  log(`encryption key : ${KEY_FILE}   ← keep a copy OFF this machine`)
}

main().catch((e) => { console.error(`\n\x1b[31m✖ ${e?.message ?? e}\x1b[0m`); process.exit(1) })
