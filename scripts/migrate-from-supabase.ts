/**
 * One-way copy: Supabase (OLD, strictly READ-ONLY) -> local Postgres (NEW schema in db/migrations).
 *
 *   npx tsx scripts/migrate-from-supabase.ts                 dry run: copies inside a transaction, prints the report, ROLLS BACK
 *   npx tsx scripts/migrate-from-supabase.ts --apply         same, but COMMITS
 *   npx tsx scripts/migrate-from-supabase.ts --apply --wipe  first empties the NEW database's app tables (re-run)
 *
 * OLD  = OLD_DATABASE_URL, else SUPABASE_DB_URL, else the commented `# DATABASE_URL=…<ref>…` line in .env
 *        (only ever opened as `BEGIN READ ONLY`; the session pooler port 5432 is used)
 * NEW  = NEW_DATABASE_URL, else DATABASE_URL from .env     (must be localhost — the script refuses anything else)
 *
 * Nothing is ever written to, updated in, or deleted from the OLD database.
 */
process.env.TZ = 'UTC' // old columns are `timestamp` (no zone) written in UTC by Supabase; read them as UTC

import fs from 'node:fs'
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')
const WIPE = process.argv.includes('--wipe')

function envFile(path: string, key: string): string | undefined {
  if (!fs.existsSync(path)) return undefined
  const line = fs.readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`))
  return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
}
function findSupabaseUrl(): string | undefined {
  const explicit = process.env.OLD_DATABASE_URL ?? process.env.SUPABASE_DB_URL
  const ref = (envFile('.env', 'NEXT_PUBLIC_SUPABASE_URL') ?? '').replace(/^https?:\/\/([^.]+)\..*$/, '$1')
  const fromFile = fs.existsSync('.env') && ref
    ? fs.readFileSync('.env', 'utf8').split('\n').find((l) => /^#?\s*DATABASE_URL=/.test(l) && l.includes(ref))?.replace(/^#?\s*DATABASE_URL=/, '').trim()
    : undefined
  const url = explicit ?? fromFile
  if (!url) return undefined
  const u = new URL(url)
  if (u.port === '6543') u.port = '5432'   // session pooler: a long consistent read needs session semantics
  return u.toString()
}
const OLD_URL = findSupabaseUrl()
const NEW_URL = process.env.NEW_DATABASE_URL ?? envFile('.env', 'DATABASE_URL')
if (!OLD_URL) throw new Error("Supabase connection string not found. Export it first:  export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'")
if (!NEW_URL) throw new Error('No local DATABASE_URL in .env (or NEW_DATABASE_URL)')
const newHost = new URL(NEW_URL).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(newHost)) throw new Error(`Refusing: NEW database host is "${newHost}", not localhost`)
if (OLD_URL === NEW_URL) throw new Error('Refusing: OLD and NEW are the same database')
process.env.DATABASE_URL = NEW_URL // for src/lib imports below

const oldDb = postgres(OLD_URL, { max: 1, prepare: false })
const newDb = postgres(NEW_URL, { max: 1, prepare: false })

type Row = Record<string, any>
const report: Array<{ table: string; old: number; neu: number; note?: string }> = []
const warn: string[] = []
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const lower = (s: string | null | undefined) => (s == null ? null : s.trim().toLowerCase())
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x }

async function insert(tx: postgres.TransactionSql, table: string, rows: Row[], cols: string[], opts: { conflict?: string } = {}) {
  let n = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))
    const res = await tx`insert into ${tx(table)} ${tx(chunk, ...cols)} ${opts.conflict ? tx.unsafe(opts.conflict) : tx.unsafe('')} returning 1`
    n += res.length
  }
  return n
}

async function main() {
  const { formatActivityLabel, formatActivityActor } = await import('../src/lib/activity-log')
  const { PREFERENCE_EVENTS } = await import('../src/lib/notifications/preferences')
  const { keyFromProxyUrl } = await import('../src/lib/r2-objects')
  const keyOf = (url: string) => keyFromProxyUrl(url) ?? url

  console.log(`\n=== Supabase -> local migration (${APPLY ? 'APPLY' : 'DRY RUN'}${WIPE ? ', WIPE' : ''}) ===`)

  await oldDb.begin('read only', async (old) => {
    await newDb.begin(async (tx) => {
      // ── guards on NEW ───────────────────────────────────────────────────────
      const [{ n: existing }] = await tx`select count(*)::int n from users`
      if (existing > 0 && !WIPE) throw new Error(`NEW database already has ${existing} users. Re-run with --wipe to replace the copied data.`)
      if (WIPE) {
        await tx`truncate users, service_catalog, invoice_counters, notification_settings restart identity cascade`
        console.log('  wiped NEW app tables (reference/seed rules in case_status_* are kept)')
      }

      const sel = async (q: string): Promise<Row[]> => [...(await old.unsafe(q))]
      const ownerOf = new Map<string, string>() // case id -> client id

      // ── 1. users + profiles ─────────────────────────────────────────────────
      const authUsers = await sel(`select id, email, encrypted_password, email_confirmed_at, last_sign_in_at, created_at from auth.users`)
      const oldProfiles = await sel(`select * from public.profiles`)
      const byId = new Map(oldProfiles.map((p) => [p.id, p]))
      const userRows: Row[] = []
      for (const u of authUsers) {
        if (!byId.has(u.id)) { warn.push(`auth.users ${u.id} has no profile — skipped`); continue }
        if (!u.encrypted_password) warn.push(`user ${u.email} has no password hash (must use "forgot password")`)
        userRows.push({
          id: u.id, email: lower(u.email), password_hash: u.encrypted_password ?? '!no-password!',
          email_verified_at: u.email_confirmed_at, last_login_at: u.last_sign_in_at, created_at: u.created_at,
        })
      }
      await insert(tx, 'users', userRows, ['id', 'email', 'password_hash', 'email_verified_at', 'last_login_at', 'created_at'])
      report.push({ table: 'auth.users -> users', old: authUsers.length, neu: userRows.length, note: 'bcrypt hashes copied verbatim (re-hashed to argon2id on first login)' })

      const subOf = new Map((await sel(`select profile_id, client_id from public.sub_users`)).map((r) => [r.profile_id, r.client_id]))
      const profileRows = oldProfiles.filter((p) => userRows.some((u) => u.id === p.id)).map((p) => ({
        id: p.id, user_type: p.user_type, user_role: p.user_role, user_status: p.user_status,
        plan_status: p.user_type === 'lab_portal' ? lower(p.plan_status) : null,
        client_id: p.user_role === 'client' ? p.id : p.user_role === 'subuser' ? (subOf.get(p.id) ?? p.created_by) : null,
        created_by: null, // set in a second pass (self-referencing)
        full_name: p.full_name, title: p.title, phone: p.phone, lab_name: p.lab_name, postal_code: p.postal_code,
        city: p.city, state: p.state, country: p.country, onboarded_at: p.onboarded_at, created_at: p.created_at, updated_at: p.updated_at,
      }))
      for (const p of profileRows) if (p.user_role === 'subuser' && !p.client_id) warn.push(`sub-user ${p.id} has no parent client`)
      await insert(tx, 'profiles', profileRows, ['id', 'user_type', 'user_role', 'user_status', 'plan_status', 'client_id', 'created_by', 'full_name', 'title', 'phone', 'lab_name', 'postal_code', 'city', 'state', 'country', 'onboarded_at', 'created_at', 'updated_at'])
      for (const p of oldProfiles) if (p.created_by && byId.has(p.created_by)) await tx`update profiles set created_by = ${p.created_by} where id = ${p.id}`
      report.push({ table: 'profiles (+sub_users)', old: oldProfiles.length, neu: profileRows.length })
      const nameToId = new Map<string, string>()
      for (const p of oldProfiles) { for (const k of [p.full_name, p.email, p.lab_name]) if (k) nameToId.set(String(k).trim().toLowerCase(), p.id) }

      // ── 2. pricing ──────────────────────────────────────────────────────────
      const cat = await sel(`select * from public.service_catalog`)
      await insert(tx, 'service_catalog', cat, ['id', 'category', 'sub_category', 'unit_type', 'default_price', 'sort_order', 'is_active', 'created_at', 'updated_at'])
      report.push({ table: 'service_catalog', old: cat.length, neu: cat.length })
      const cpl = (await sel(`select * from public.client_price_list`)).filter((r) => profileRows.some((p) => p.id === r.client_id))
      await insert(tx, 'client_price_list', cpl, ['id', 'client_id', 'catalog_item_id', 'price', 'notes', 'is_enabled', 'created_by', 'created_at', 'updated_at'])
      report.push({ table: 'client_price_list', old: cpl.length, neu: cpl.length })

      // ── 3. cases (+ case_details) ───────────────────────────────────────────
      const oldCases = await sel(`select * from public.cases`)
      const caseRows = oldCases.map((c) => {
        const creator = c.created_by ? (UUID.test(c.created_by) ? c.created_by : nameToId.get(String(c.created_by).trim().toLowerCase())) : null
        if (c.created_by && !creator) warn.push(`case ${c.case_number}: creator "${c.created_by}" matches no profile (created_by_id left empty)`)
        ownerOf.set(c.id, c.client_id)
        const finished = c.status === 'approved' || c.status === 'delivered'
        if (c.delivered_time && !finished) warn.push(`case ${c.case_number}: completed_at dropped (status ${c.status} is not approved/delivered)`)
        return {
          id: c.id, case_number: c.case_number, client_id: c.client_id, subuser_id: c.subuser_id, created_by_id: creator,
          category: c.category ?? 'Unknown', sub_type_data: tx.json(c.sub_type_data ?? {}), status: c.status,
          hold_reason: c.hold_reason, cancel_reason: c.cancel_reason, feedback_reason: c.feedback_reason, reject_reason: c.reject_reason,
          designer_id: c.designer_id, qc_id: c.qc_id, account_manager_id: c.account_manager_id, auto_approved: c.auto_approved ?? false,
          submitted_to_client_at: c.submitted_to_client_at, started_at: c.start_time, completed_at: finished ? c.delivered_time : null,
          tat_minutes: c.tat, due_date: c.due_date, client_output_downloaded_at: c.client_output_downloaded_at,
          internal_files_downloaded_at: c.internal_files_downloaded_at, preferred_teeth_library: c.preferred_teeth_library ?? 'default',
          created_at: c.created_at, updated_at: c.updated_at,
        }
      })
      // The BEFORE UPDATE trigger would overwrite updated_at; INSERT keeps the supplied value.
      await insert(tx, 'cases', caseRows, Object.keys(caseRows[0] ?? { id: 1 }))
      const details = oldCases.map((c) => ({ case_id: c.id, approval_checklist: tx.json(c.approval_checklist ?? []), output_note: c.output_note, client_message: c.client_massage }))
      await insert(tx, 'case_details', details, ['case_id', 'approval_checklist', 'output_note', 'client_message'])
      const seq = await old.unsafe(`select last_value::bigint v, is_called c from public.cases_number_seq`).catch(() => [])
      if (seq[0]) await tx`select setval('cases_number_seq', ${Number(seq[0].v)}, ${seq[0].c})`
      report.push({ table: 'cases (+case_details)', old: oldCases.length, neu: caseRows.length, note: seq[0] ? `cases_number_seq -> ${seq[0].v}` : 'no sequence found' })

      // ── 4. files registry ───────────────────────────────────────────────────
      type F = { kind: string; case_id: string | null; message_id?: string | null; uploaded_by: string | null; file_name: string; url: string; type?: string | null; size?: number | null; note?: string | null; created_at: Date; id?: string }
      const fl: F[] = []
      for (const [tbl, kind] of [['case_files', 'scan'], ['case_preview_files', 'preview'], ['case_reference_files', 'reference'], ['case_hold_files', 'hold']] as const) {
        for (const r of await sel(`select * from public.${tbl}`)) fl.push({ id: r.id, kind, case_id: r.case_id, uploaded_by: r.uploaded_by, file_name: r.file_name, url: r.file_url, type: r.file_type, size: r.file_size == null ? null : Number(r.file_size), note: r.note, created_at: r.created_at })
      }
      const nameFromUrl = (u: string) => (decodeURIComponent((u.match(/[?&]fileName=([^&]+)/)?.[1]) ?? u.split('/').pop() ?? 'file')).split('/').pop()!
      for (const c of oldCases) {
        if (c.output_file) fl.push({ kind: 'output', case_id: c.id, uploaded_by: c.designer_id, file_name: nameFromUrl(c.output_file), url: c.output_file, created_at: c.updated_at })
        if (c.preview_file) fl.push({ kind: 'preview', case_id: c.id, uploaded_by: c.designer_id, file_name: nameFromUrl(c.preview_file), url: c.preview_file, created_at: c.updated_at })
        if (c.teeth_library_file_url) fl.push({ kind: 'teeth_library', case_id: c.id, uploaded_by: c.client_id, file_name: c.teeth_library_file_name || nameFromUrl(c.teeth_library_file_url), url: c.teeth_library_file_url, created_at: c.created_at })
      }
      // chat messages (+ attachments) before files so message ids exist
      const chat = await sel(`select * from public.chat_messages`)
      const chatRows = chat.filter((m) => ownerOf.has(m.case_id) && byId.has(m.sender_id)).map((m) => ({ id: m.id, case_id: m.case_id, sender_id: m.sender_id, sender_role: m.sender_role, message_text: m.message_text ?? '', created_at: m.created_at }))
      await insert(tx, 'chat_messages', chatRows, ['id', 'case_id', 'sender_id', 'sender_role', 'message_text', 'created_at'])
      for (const m of chat) if (m.file_url && ownerOf.has(m.case_id)) fl.push({ kind: 'chat', case_id: null, message_id: m.id, uploaded_by: m.sender_id, file_name: m.file_name || nameFromUrl(m.file_url), url: m.file_url, type: m.file_type, size: m.file_size ? Number(m.file_size) : null, created_at: m.created_at })
      report.push({ table: 'chat_messages', old: chat.length, neu: chatRows.length })

      const seen = new Set<string>()
      const fileRows: Row[] = []
      let dupKeys = 0
      for (const f of fl) {
        const key = keyOf(f.url)
        const dedupe = `${key}|${f.kind}|${f.case_id ?? f.message_id}`
        if (seen.has(dedupe)) { dupKeys++; continue } // same object, same role, same owner listed twice
        seen.add(dedupe)
        const clientId = f.case_id ? ownerOf.get(f.case_id) : (chat.find((m) => m.id === f.message_id) ? ownerOf.get(chat.find((m) => m.id === f.message_id)!.case_id) : undefined)
        if (!clientId) { warn.push(`file ${f.file_name}: owning case/lab not found — skipped`); continue }
        fileRows.push({
          id: f.id && !fileRows.some((r) => r.id === f.id) ? f.id : crypto.randomUUID(), client_id: clientId, case_id: f.case_id, message_id: f.message_id ?? null,
          kind: f.kind, uploaded_by: f.uploaded_by && byId.has(f.uploaded_by) ? f.uploaded_by : null, file_name: f.file_name.slice(0, 255), r2_key: key,
          content_type: f.type ?? null, size_bytes: f.size ?? null, note: f.note ?? null, status: 'ready', ready_at: f.created_at,
          created_at: f.created_at, purge_after: addMonths(f.created_at, 3),
        })
      }
      await insert(tx, 'files', fileRows, ['id', 'client_id', 'case_id', 'message_id', 'kind', 'uploaded_by', 'file_name', 'r2_key', 'content_type', 'size_bytes', 'note', 'status', 'ready_at', 'created_at', 'purge_after'])
      report.push({ table: 'files (4 tables + output/preview/teeth-library + chat)', old: fl.length, neu: fileRows.length, note: `${dupKeys} exact duplicate(s) (same object+role+owner) collapsed` })

      // ── 5. activity: timeline events + audit rows, merged ──────────────────
      const audit = await sel(`select * from public.activity_logs order by action_at`)
      const used = new Set<string>()
      const actRows: Row[] = []
      const profLite = (id: string | null) => { const p = id ? byId.get(id) : null; return p ? { fullName: p.full_name, labName: p.lab_name, role: p.user_role } : null }
      for (const c of oldCases) {
        for (const ev of (Array.isArray(c.timeline) ? c.timeline : []) as Row[]) {
          const t = new Date(ev.actionAt).getTime()
          const m = audit.find((a) => !used.has(a.id) && a.case_id === c.id && a.action === ev.action && Math.abs(new Date(a.action_at).getTime() - t) < 5000)
          if (m) used.add(m.id)
          actRows.push({
            id: UUID.test(ev.id ?? '') ? ev.id : crypto.randomUUID(), case_id: c.id, user_id: m && byId.has(m.user_id) ? m.user_id : null,
            actor_type: m?.user_type ?? null, actor_role: m?.user_role ?? null, actor_name: ev.actor ?? 'System', action: String(ev.action).slice(0, 120),
            label: ev.label, client_label: ev.clientLabel ?? null, client_visible: !ev.clientHidden, details: m?.details ? tx.json(m.details) : null, action_at: new Date(ev.actionAt),
          })
        }
      }
      for (const a of audit) { // audit rows with no timeline twin (non-case events, or timeline lost)
        if (used.has(a.id)) continue
        const lite = profLite(a.user_id)
        actRows.push({
          id: a.id, case_id: a.case_id && ownerOf.has(a.case_id) ? a.case_id : null, user_id: byId.has(a.user_id) ? a.user_id : null,
          actor_type: a.user_type, actor_role: a.user_role, actor_name: lite ? formatActivityActor({ fullName: lite.fullName, labName: lite.labName, role: lite.role } as any) : 'System',
          action: a.action, label: formatActivityLabel(a.action, a.details ?? null, a.user_role), client_label: null, client_visible: false, details: a.details ? tx.json(a.details) : null, action_at: a.action_at,
        })
      }
      const idSeen = new Set<string>(); const actUnique = actRows.filter((r) => (idSeen.has(r.id) ? false : (idSeen.add(r.id), true)))
      await insert(tx, 'activity_logs', actUnique, ['id', 'case_id', 'user_id', 'actor_type', 'actor_role', 'actor_name', 'action', 'label', 'client_label', 'client_visible', 'details', 'action_at'])
      const tlCount = oldCases.reduce((n, c) => n + (Array.isArray(c.timeline) ? c.timeline.length : 0), 0)
      report.push({ table: 'timeline events + activity_logs -> activity_logs', old: tlCount + audit.length, neu: actUnique.length, note: `${used.size} audit rows were duplicates of timeline events and merged` })

      // ── 6. chat read state, notifications, preferences, sidebar ────────────
      const crs = (await sel(`select * from public.chat_read_states`)).filter((r) => ownerOf.has(r.case_id) && byId.has(r.user_id))
      const crsMap = new Map(crs.map((r) => [`${r.case_id}:${r.user_id}`, r]))
      await insert(tx, 'chat_read_states', [...crsMap.values()], ['case_id', 'user_id', 'last_read_at'])
      report.push({ table: 'chat_read_states', old: crs.length, neu: crsMap.size })

      const nots = (await sel(`select * from public.notifications`)).filter((r) => byId.has(r.user_id))
      await insert(tx, 'notifications', nots.map((n) => {
        const cid = n.metadata?.caseId
        return { id: n.id, user_id: n.user_id, type: n.type, title: n.title, message: n.message, link: n.link, entity_type: UUID.test(cid ?? '') ? 'case' : null, entity_id: UUID.test(cid ?? '') ? cid : null,
          metadata: n.metadata ? tx.json(n.metadata) : null, is_read: n.is_read, is_dismissed: n.is_dismissed, read_at: n.is_read ? n.updated_at : null, created_at: n.created_at }
      }), ['id', 'user_id', 'type', 'title', 'message', 'link', 'entity_type', 'entity_id', 'metadata', 'is_read', 'is_dismissed', 'read_at', 'created_at'])
      report.push({ table: 'notifications', old: nots.length, neu: nots.length })

      const prefs = (await sel(`select * from public.notification_preferences`)).filter((r) => byId.has(r.user_id))
      const settings: Row[] = []; const evRows: Row[] = []
      const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
      for (const p of prefs) {
        if (!p.email_enabled || !p.in_app_enabled) settings.push({ user_id: p.user_id, email_enabled: p.email_enabled, in_app_enabled: p.in_app_enabled })
        for (const [camel, ev] of Object.entries(PREFERENCE_EVENTS)) {
          const e = p[`${snake(camel)}_email`] ?? true, i = p[`${snake(camel)}_in_app`] ?? true
          if (!e || !i) evRows.push({ user_id: p.user_id, event_type: ev, email_enabled: e, in_app_enabled: i })
        }
      }
      await insert(tx, 'notification_settings', settings, ['user_id', 'email_enabled', 'in_app_enabled'])
      await insert(tx, 'notification_preferences', evRows, ['user_id', 'event_type', 'email_enabled', 'in_app_enabled'])
      report.push({ table: 'notification_preferences -> settings + opt-out rows', old: prefs.length, neu: settings.length + evRows.length, note: `only switches that are OFF are stored (${evRows.length} event opt-outs, ${settings.length} master overrides)` })

      const seenAt = new Map((await sel(`select * from public.sidebar_seen_at`)).filter((r) => byId.has(r.user_id)).map((r) => [`${r.user_id}:${r.page_key}`, r]))
      await insert(tx, 'sidebar_seen_at', [...seenAt.values()], ['user_id', 'page_key', 'last_seen_at'])
      report.push({ table: 'sidebar_seen_at', old: seenAt.size, neu: seenAt.size })

      // ── 7. forms, downloads, support, offers, tutorials, invoices ──────────
      const forms = await sel(`select * from public.preference_forms`)
      const formSeen = new Set<string>(); const formRows = forms.filter((f) => byId.has(f.client_id)).filter((f) => { const k = `${f.client_id}:${f.form_name.toLowerCase()}`; if (formSeen.has(k)) { warn.push(`preference form "${f.form_name}" duplicated for a lab — one kept`); return false } formSeen.add(k); return true })
        .map((f) => ({ ...f, payload: tx.json(f.payload), is_system_default: /^Default Preferences/i.test(f.form_name), created_by: f.created_by && byId.has(f.created_by) ? f.created_by : null }))
      await insert(tx, 'preference_forms', formRows, ['id', 'client_id', 'form_name', 'payload', 'is_system_default', 'created_by', 'created_at', 'updated_at'])
      report.push({ table: 'preference_forms', old: forms.length, neu: formRows.length })

      const bd = (await sel(`select * from public.case_bulk_downloads`)).filter((r) => ownerOf.has(r.case_id))
      const validRole = new Set(['client', 'subuser', 'admin', 'qc', 'account_manager', 'designer'])
      await insert(tx, 'case_bulk_downloads', bd.map((r) => ({ ...r, downloaded_by: r.downloaded_by && byId.has(r.downloaded_by) ? r.downloaded_by : null, downloaded_by_role: validRole.has(r.downloaded_by_role) ? r.downloaded_by_role : null,
        fingerprints: r.fingerprints ? tx.json(r.fingerprints) : null, include: r.include ? tx.json(r.include) : null })),
        ['id', 'case_id', 'client_id', 'scope', 'status', 'downloaded_by', 'downloaded_by_role', 'files_delivered', 'bytes_delivered', 'content_signature', 'fingerprints', 'include', 'failure_reason', 'started_at', 'completed_at'])
      report.push({ table: 'case_bulk_downloads', old: bd.length, neu: bd.length })

      const tickets = (await sel(`select * from public.support_tickets`)).filter((r) => byId.has(r.client_id))
      await insert(tx, 'support_tickets', tickets, ['id', 'ticket_number', 'client_id', 'subject', 'message', 'category', 'priority', 'status', 'admin_notes', 'resolved_at', 'created_by', 'created_at', 'updated_at'])
      report.push({ table: 'support_tickets', old: tickets.length, neu: tickets.length, note: tickets.length ? '' : 'empty in OLD — mapping untested with data' })
      const cbs = (await sel(`select * from public.support_callback_requests`)).filter((r) => byId.has(r.client_id))
      await insert(tx, 'support_callback_requests', cbs.map((r) => ({ ...r, email: lower(r.email) })), ['id', 'client_id', 'phone', 'email', 'created_by', 'requested_at'])
      report.push({ table: 'support_callback_requests', old: cbs.length, neu: cbs.length, note: cbs.length ? '' : 'empty in OLD — mapping untested with data' })

      const offers = await sel(`select * from public.offers`)
      await insert(tx, 'offers', offers.map((o) => ({ ...o, target_client_ids: tx.array((o.target_clients ?? []).filter((x: string) => UUID.test(x)), 'uuid' as any), target_locations: tx.array(o.target_locations ?? [], 'text' as any) })),
        ['id', 'title', 'brand', 'category', 'description', 'discount', 'start_date', 'valid_till', 'target_client_ids', 'target_locations', 'sponsored', 'active', 'created_by', 'created_at', 'updated_at'])
      report.push({ table: 'offers', old: offers.length, neu: offers.length, note: offers.length ? '' : 'empty in OLD — mapping untested with data' })
      const claims = (await sel(`select * from public.offer_claims`)).filter((r) => byId.has(r.client_id))
      await insert(tx, 'offer_claims', claims, ['id', 'offer_id', 'client_id', 'status', 'created_at'])
      report.push({ table: 'offer_claims', old: claims.length, neu: claims.length })
      const tut = await sel(`select * from public.tutorials`)
      await insert(tx, 'tutorials', tut, ['id', 'title', 'category', 'description', 'youtube_video_id', 'created_by', 'created_at', 'updated_at'])
      report.push({ table: 'tutorials', old: tut.length, neu: tut.length })

      const invs = (await sel(`select * from public.invoices`)).filter((r) => byId.has(r.client_id))
      await insert(tx, 'invoices', invs.map((i) => ({ ...i, items: tx.json(i.items ?? []), created_by: i.created_by && byId.has(i.created_by) ? i.created_by : null })),
        ['id', 'invoice_number', 'client_id', 'start_date', 'end_date', 'items', 'subtotal', 'tax_type', 'tax_value', 'tax_amount', 'discount_type', 'discount_value', 'discount_amount', 'extra_charges_type', 'extra_charges_value', 'extra_charges_amount', 'total', 'status', 'remarks', 'terms_of_payment', 'client_paid', 'client_payment_date', 'received', 'received_confirmation_id', 'received_on', 'created_by', 'created_at', 'updated_at'])
      const links: Row[] = []
      for (const i of invs) for (const cid of (Array.isArray(i.case_ids) ? i.case_ids : []) as string[]) if (ownerOf.has(cid)) links.push({ invoice_id: i.id, case_id: cid }); else warn.push(`invoice ${i.invoice_number}: case ${cid} no longer exists`)
      await insert(tx, 'invoice_cases', links, ['invoice_id', 'case_id'])
      const yearMax = new Map<number, number>()
      for (const i of invs) { const m = /^Inv_(\d{4})_(\d+)$/.exec(i.invoice_number); if (m) yearMax.set(+m[1], Math.max(yearMax.get(+m[1]) ?? 0, +m[2])) }
      for (const [y, s] of yearMax) await tx`insert into invoice_counters (year, last_seq) values (${y}, ${s}) on conflict (year) do update set last_seq = excluded.last_seq`
      report.push({ table: 'invoices (+invoice_cases, counters)', old: invs.length, neu: invs.length, note: invs.length ? `${links.length} case links` : 'empty in OLD — mapping untested with data' })

      // ── 8. verification (inside the same transaction) ──────────────────────
      console.log('\nVerifying...')
      const bad: string[] = []
      for (const u of userRows) { const [r] = await tx`select password_hash from users where id = ${u.id}`; if (r.password_hash !== u.password_hash) bad.push(`password hash mismatch for ${u.email}`) }
      const [{ n: orphanFiles }] = await tx`select count(*)::int n from files f where f.case_id is null and f.message_id is null`
      if (orphanFiles) bad.push(`${orphanFiles} files without case/message`)
      const [{ n: noClient }] = await tx`select count(*)::int n from profiles where user_role='subuser' and client_id is null`
      if (noClient) bad.push(`${noClient} sub-users without a parent client`)
      for (const [t, expected] of [['users', userRows.length], ['profiles', profileRows.length], ['cases', caseRows.length], ['case_details', caseRows.length], ['client_price_list', cpl.length], ['service_catalog', cat.length], ['files', fileRows.length], ['activity_logs', actUnique.length], ['notifications', nots.length]] as const) {
        const [{ n }] = await tx`select count(*)::int n from ${tx(t)}`
        if (n !== expected) bad.push(`${t}: expected ${expected}, found ${n}`)
      }
      if (bad.length) throw new Error('Verification failed:\n  - ' + bad.join('\n  - '))
      await tx`refresh materialized view mv_cases_created_daily`
      await tx`refresh materialized view mv_cases_completed_daily`

      console.table(report.map((r) => ({ table: r.table, supabase: r.old, local: r.neu, note: r.note ?? '' })))
      if (warn.length) { console.log('\nWarnings:'); warn.forEach((w) => console.log('  - ' + w)) }
      if (!APPLY) { console.log('\nDRY RUN OK — nothing was kept. Re-run with --apply to commit.'); throw new RollbackSignal() }
      console.log('\nAPPLIED — data committed to the local database.')
    })
  }).catch((e) => { if (!(e instanceof RollbackSignal)) throw e })
}

class RollbackSignal extends Error {}
main().then(async () => { await oldDb.end(); await newDb.end() }).catch(async (e) => { console.error('\nFAILED (nothing committed):', e.message ?? e); await oldDb.end(); await newDb.end(); process.exit(1) })
