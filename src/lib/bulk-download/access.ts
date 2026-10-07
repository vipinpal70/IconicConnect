import { NextResponse } from 'next/server'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/src/db'
import { cases } from '@/src/db/schema/case'
import { profiles } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { MAX_CASES_PER_DOWNLOAD, CLIENT_OUTPUT_VISIBLE_STATUSES } from './limits'
import type { AuthedProfile, DownloadScope, SkippedItem } from './types'

const CLIENT_ROLES = new Set(['client', 'subuser'])
// Same internal allow-list as /api/cases/files.
const INTERNAL_ROLES = new Set(['admin', 'qc', 'designer', 'account_manager'])

export type CaseRow = typeof cases.$inferSelect

export async function authenticate(scope: DownloadScope) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const profile = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1).then((r) => r[0])
  if (!profile) return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }

  const allowed = scope === 'client_output' ? CLIENT_ROLES : INTERNAL_ROLES
  if (!allowed.has(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { profile: profile as AuthedProfile }
}

/**
 * Read ids (and any extra fields) from a JSON body (manifest) or a plain form post
 * (download — a hidden <form> so the browser handles the file natively).
 * Form fields: `caseIds` (JSON array string) plus flat string fields.
 */
export async function readRequest(req: Request): Promise<{ caseIds: string[]; fields: Record<string, unknown> }> {
  const ct = req.headers.get('content-type') ?? ''
  let fields: Record<string, unknown> = {}
  if (ct.includes('application/json')) {
    fields = (await req.json().catch(() => ({}))) as Record<string, unknown>
  } else {
    const form = await req.formData().catch(() => null)
    if (form) {
      for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v
      if (typeof fields.caseIds === 'string') {
        try { fields.caseIds = JSON.parse(fields.caseIds) } catch { fields.caseIds = [] }
      }
      if (typeof fields.include === 'string') {
        try { fields.include = JSON.parse(fields.include) } catch { fields.include = undefined }
      }
    }
  }
  const raw = fields.caseIds
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  return { caseIds: Array.from(new Set(ids)), fields }
}

export function validateCount(caseIds: string[]) {
  if (caseIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one case' }, { status: 400 })
  }
  if (caseIds.length > MAX_CASES_PER_DOWNLOAD) {
    return NextResponse.json(
      { error: `You can download at most ${MAX_CASES_PER_DOWNLOAD} cases at a time` },
      { status: 400 },
    )
  }
  return null
}

/**
 * Load the requested cases the caller may download. Everything else is returned in
 * `skipped` with a reason (never a hard failure for the whole batch).
 */
export async function loadDownloadableCases(
  profile: AuthedProfile,
  scope: DownloadScope,
  caseIds: string[],
): Promise<{ cases: CaseRow[]; skipped: SkippedItem[] }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validIds = caseIds.filter((id) => uuid.test(id))
  const rows = validIds.length ? await db.select().from(cases).where(inArray(cases.id, validIds)) : []
  const byId = new Map(rows.map((r) => [r.id, r]))

  const effectiveClientId =
    profile.role === 'subuser' ? (profile.createdBy ?? profile.id) : profile.id

  const ok: CaseRow[] = []
  const skipped: SkippedItem[] = []
  for (const id of caseIds) {
    const row = byId.get(id)
    if (!row || (scope === 'client_output' && row.clientId !== effectiveClientId)) {
      skipped.push({ caseId: id, reason: 'Case not found or not accessible' })
      continue
    }
    if (
      scope === 'client_output' &&
      !(CLIENT_OUTPUT_VISIBLE_STATUSES as readonly string[]).includes(row.status)
    ) {
      skipped.push({ caseId: id, caseNumber: row.caseNumber, reason: 'Output not available yet' })
      continue
    }
    ok.push(row)
  }
  return { cases: ok, skipped }
}
