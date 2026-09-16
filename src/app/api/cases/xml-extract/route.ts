import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import {
  cases,
  caseFiles,
  caseStatusEnum,
  CASE_STATUS_TO_LIFECYCLE_STEP,
} from '@/src/db/schema/case'
import { profiles, subUsers } from '@/src/db/schema/profile'
import { createClient } from '@/src/lib/supabase/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { getProfileLabName } from '@/src/lib/profile-utils'
import { logActivity } from '@/src/lib/activity-log'
import { extractPackage, r2RangeReader } from '@/src/lib/three-shape'
import type { ExtractResult } from '@/src/lib/three-shape/package'

/**
 * 3Shape XML Import — extraction endpoint (xml-work-plan.md §8).
 *
 * READ-ONLY. Given a list of `.zip`s already uploaded to R2 (via the existing
 * chunked flow), it byte-ranges each one, reads the single order XML (Q4), and
 * returns a pre-filled case-form draft + the full normalized domain model +
 * an advisory duplicate flag. It never writes to the database — a case is only
 * created when the client presses Submit on the review carousel, through the
 * existing `POST /api/cases`.
 */

export const maxDuration = 60

// Everything not yet 'Completed' on the client-facing lifecycle — mirrors the
// (unexported) constant in `src/app/api/cases/route.ts`. Duplicate suppression
// only considers cases in one of these (Q2 — active only).
const ACTIVE_CASE_STATUSES = caseStatusEnum.enumValues.filter(
  (status) => CASE_STATUS_TO_LIFECYCLE_STEP[status] !== 'Completed',
)

const MAX_FILES = 5

type IncomingFile = { fileName: string; fileUrl?: string; fileSize?: number; fileType?: string }

type DuplicateOf = { caseId: string; caseNumber: string | null; status: string }

type ApiResult =
  | (Extract<ExtractResult, { ok: true }> & { duplicateOf: DuplicateOf | null })
  | Extract<ExtractResult, { ok: false }>

/** Strip any directory prefix, drop the extension, trim + lowercase. */
function normalizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase()
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error'
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1)
      .then((r) => r[0])
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Q3 — client & subuser only for v1.
    if (profile.role !== 'client' && profile.role !== 'subuser') {
      return NextResponse.json(
        { error: '3Shape import is available to dental-lab accounts only' },
        { status: 403 },
      )
    }

    // Resolve the owning client + the R2 lab-name prefix.
    let clientId: string
    let labName: string
    if (profile.role === 'client') {
      clientId = profile.id
      labName = getProfileLabName(profile)
    } else {
      const sub = await db
        .select()
        .from(subUsers)
        .where(eq(subUsers.id, profile.id))
        .limit(1)
        .then((r) => r[0])
      if (!sub) {
        return NextResponse.json({ error: 'Subuser parent client not found' }, { status: 400 })
      }
      clientId = sub.clientId
      const parent = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, clientId))
        .limit(1)
        .then((r) => r[0])
      labName = getProfileLabName(parent)
    }

    const body = (await req.json().catch(() => null)) as { files?: IncomingFile[] } | null
    const files = body?.files
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Upload at most ${MAX_FILES} zip files at a time` },
        { status: 400 },
      )
    }

    for (const f of files) {
      const name = f?.fileName
      if (!name || typeof name !== 'string' || /[\\/]/.test(name) || name.includes('..')) {
        return NextResponse.json({ error: `Invalid file name: ${String(name)}` }, { status: 400 })
      }
      if (!name.toLowerCase().endsWith('.zip')) {
        return NextResponse.json(
          { error: `"${name}" is not a .zip — 3Shape import accepts DentalContainer zip exports only` },
          { status: 400 },
        )
      }
      // If a fileUrl is supplied it must point at THIS lab's namespace; the R2
      // key is always rebuilt server-side from labName + fileName regardless.
      if (f.fileUrl && typeof f.fileUrl === 'string') {
        const m = /[?&]labName=([^&]+)/.exec(f.fileUrl)
        if (m && decodeURIComponent(m[1]) !== labName) {
          return NextResponse.json({ error: 'File does not belong to your lab' }, { status: 403 })
        }
      }
    }

    // ── Extract each package, isolated ─────────────────────────────────────────
    const settled = await Promise.allSettled(
      files.map((f) => {
        const key = `${labName}/${f.fileName}`
        return extractPackage(r2RangeReader(key), f.fileName)
      }),
    )
    const results: ApiResult[] = settled.map((s, i): ApiResult => {
      if (s.status === 'fulfilled') {
        return s.value.ok ? { ...s.value, duplicateOf: null } : s.value
      }
      return {
        ok: false,
        packageName: files[i].fileName,
        error: { code: 'XML_UNREADABLE', message: getErrorMessage(s.reason) },
      }
    })

    // ── Advisory duplicate check (Q2 — active cases only) ─────────────────────
    const okResults = results.filter((r): r is Extract<ApiResult, { ok: true }> => r.ok)
    if (okResults.length > 0) {
      const activeRows = await db
        .select({
          id: cases.id,
          caseNumber: cases.caseNumber,
          status: cases.status,
          subTypeData: cases.subTypeData,
        })
        .from(cases)
        .where(and(eq(cases.clientId, clientId), inArray(cases.status, ACTIVE_CASE_STATUSES)))

      const caseIds = activeRows.map((r) => r.id)
      const earliestFileName = new Map<string, string>()
      if (caseIds.length > 0) {
        const fileRows = await db
          .select({ caseId: caseFiles.caseId, fileName: caseFiles.fileName })
          .from(caseFiles)
          .where(inArray(caseFiles.caseId, caseIds))
          .orderBy(asc(caseFiles.createdAt))
        for (const row of fileRows) {
          if (row.caseId && !earliestFileName.has(row.caseId)) {
            earliestFileName.set(row.caseId, row.fileName)
          }
        }
      }

      const byName = new Map<string, Array<{ caseId: string; caseNumber: string | null; status: string; teeth: Set<number> }>>()
      for (const row of activeRows) {
        const fn = earliestFileName.get(row.id)
        if (!fn) continue
        const key = normalizeName(fn)
        const teethArr = (row.subTypeData as { teeth?: unknown } | null)?.teeth
        const teeth = new Set<number>(Array.isArray(teethArr) ? (teethArr as number[]) : [])
        const bucket = byName.get(key) ?? []
        bucket.push({ caseId: row.id, caseNumber: row.caseNumber, status: row.status, teeth })
        byName.set(key, bucket)
      }

      for (const r of okResults) {
        const draftTeeth = new Set(r.draft.subTypeData.teeth)
        const candidates = byName.get(normalizeName(r.packageName)) ?? []
        const hit = candidates.find(
          (c) => c.teeth.size > 0 && [...draftTeeth].some((t) => c.teeth.has(t)),
        )
        if (hit) {
          r.duplicateOf = { caseId: hit.caseId, caseNumber: hit.caseNumber, status: hit.status }
        }
      }
    }

    logActivity({
      actor: profile,
      action: 'case.xml_extracted',
      caseId: null,
      details: {
        count: files.length,
        failed: results.filter((r) => !r.ok).length,
        duplicates: okResults.filter((r) => r.duplicateOf).length,
        warningCodes: okResults.flatMap((r) => r.threeShape.dataQuality.warnings.map((w) => w.code)),
      },
    }).catch((err) => console.error('[XmlExtract] activity log failed:', err))

    return NextResponse.json({ results })
  } catch (error: unknown) {
    console.error('XML extract route error:', error)
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
