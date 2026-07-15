import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, caseFiles } from '@/src/db/schema/case';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, inArray, asc } from 'drizzle-orm';

/**
 * Bulk match — given a list of uploaded output file names, find the eligible case each
 * one belongs to. A case is eligible when its status is `in_progress`; the match key is
 * the case's ORIGINAL scan file name (the earliest `case_files` row), compared without
 * extension and case-insensitively — the same rule the single-upload flow enforces.
 *
 * Independent of the existing case APIs; read-only.
 */

const ALLOWED_ROLES = new Set(['designer', 'qc', 'admin']);

/** Strip any directory prefix, drop the extension, trim + lowercase. */
function normalizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.substring(0, lastDot) : base;
  return stem.trim().toLowerCase();
}

type MatchStatus = 'matched' | 'unmatched' | 'ambiguous' | 'duplicate';

type EligibleCase = {
  id: string;
  caseNumber: string | null;
  category: string | null;
  scanFileName: string | null;
  clientDisplayName: string | null;
  qcId: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const profile = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1).then(r => r[0]);
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    if (!ALLOWED_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null) as { files?: Array<{ tempId: string; fileName: string }> } | null;
    const files = body?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // 1. Load all eligible (in-progress) cases.
    const eligibleRows = await db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        category: cases.category,
        clientId: cases.clientId,
        qcId: cases.qcId,
      })
      .from(cases)
      .where(eq(cases.status, 'in_progress'));

    // 2. First (earliest) scan file name per case — mirrors /api/cases GET scanFileName logic.
    const caseIds = eligibleRows.map(r => r.id);
    const scanFileMap = new Map<string, string>();
    if (caseIds.length > 0) {
      const fileRows = await db
        .select({ caseId: caseFiles.caseId, fileName: caseFiles.fileName })
        .from(caseFiles)
        .where(inArray(caseFiles.caseId, caseIds))
        .orderBy(asc(caseFiles.createdAt));
      for (const row of fileRows) {
        if (row.caseId && !scanFileMap.has(row.caseId)) {
          scanFileMap.set(row.caseId, row.fileName);
        }
      }
    }

    // 3. Client display names.
    const clientIds = Array.from(new Set(eligibleRows.map(r => r.clientId).filter(Boolean)));
    const clientMap = new Map<string, string>();
    if (clientIds.length > 0) {
      const clientRows = await db
        .select({ id: profiles.id, labName: profiles.labName, fullName: profiles.fullName, email: profiles.email })
        .from(profiles)
        .where(inArray(profiles.id, clientIds));
      for (const c of clientRows) {
        clientMap.set(c.id, c.labName || c.fullName || c.email || '—');
      }
    }

    const eligibleCases: EligibleCase[] = eligibleRows.map(r => ({
      id: r.id,
      caseNumber: r.caseNumber,
      category: r.category,
      scanFileName: scanFileMap.get(r.id) ?? null,
      clientDisplayName: r.clientId ? (clientMap.get(r.clientId) ?? null) : null,
      qcId: r.qcId ?? null,
    }));

    // 4. Index cases by normalized scan file name.
    const casesByName = new Map<string, EligibleCase[]>();
    for (const c of eligibleCases) {
      if (!c.scanFileName) continue;
      const key = normalizeName(c.scanFileName);
      const bucket = casesByName.get(key);
      if (bucket) bucket.push(c);
      else casesByName.set(key, [c]);
    }

    // 5. Match each uploaded file; detect duplicates (two files -> same case / same name).
    const nameCounts = new Map<string, number>();
    for (const f of files) nameCounts.set(normalizeName(f.fileName), (nameCounts.get(normalizeName(f.fileName)) ?? 0) + 1);

    const results = files.map(f => {
      const key = normalizeName(f.fileName);
      const candidates = casesByName.get(key) ?? [];
      let status: MatchStatus;
      let matchedCaseId: string | null = null;

      if (candidates.length === 0) {
        status = 'unmatched';
      } else if ((nameCounts.get(key) ?? 0) > 1) {
        // The same output name was uploaded more than once — force the user to resolve.
        status = 'duplicate';
        matchedCaseId = candidates.length === 1 ? candidates[0].id : null;
      } else if (candidates.length > 1) {
        status = 'ambiguous';
      } else {
        status = 'matched';
        matchedCaseId = candidates[0].id;
      }

      return {
        tempId: f.tempId,
        fileName: f.fileName,
        status,
        matchedCaseId,
        candidateIds: candidates.map(c => c.id),
      };
    });

    return NextResponse.json({ results, eligibleCases });
  } catch (error: unknown) {
    console.error('Bulk match route error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
