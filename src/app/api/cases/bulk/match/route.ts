import { users } from '@/src/db/schema/profile'
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases } from '@/src/db/schema/case';
import { listByCases } from '@/src/lib/files-repo';
import { profiles } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/auth/server';
import { eq, inArray, desc } from 'drizzle-orm';
import { BULK_UPLOAD_ROLES, bulkEligibleCasesFilter } from '@/src/lib/bulk-output-eligibility';
import { matchFile, type MatchableCase } from '@/src/lib/bulk-output-matching';

/**
 * Bulk match — given output file NAMES (called before anything is uploaded), find the case each
 * belongs to among the cases this user may attach outputs to (see bulk-output-eligibility.ts).
 *
 * Every scan file of a case and its case number are match keys; the tiers are defined in
 * bulk-output-matching.ts and shared with the UI. Read-only.
 */

const MAX_FILES = 500;

export type EligibleCase = MatchableCase & {
  category: string | null;
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
    const eligibility = BULK_UPLOAD_ROLES.has(profile.role) ? bulkEligibleCasesFilter(profile) : undefined;
    if (!eligibility) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null) as { files?: Array<{ tempId: string; fileName: string }> } | null;
    const files = body?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `At most ${MAX_FILES} files per batch` }, { status: 400 });
    }
    if (files.some((f) => typeof f?.tempId !== 'string' || typeof f?.fileName !== 'string' || f.fileName.length > 255)) {
      return NextResponse.json({ error: 'Invalid file list' }, { status: 400 });
    }

    // 1. Only the cases this user may attach outputs to.
    const eligibleRows = await db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        category: cases.category,
        clientId: cases.clientId,
        qcId: cases.qcId,
      })
      .from(cases)
      .where(eligibility)
      .orderBy(desc(cases.updatedAt));

    // 2. Every scan file name per case (labs often upload several, and the first may be a photo).
    const caseIds = eligibleRows.map(r => r.id);
    const scans = await listByCases(caseIds, 'scan');
    const scanNames = new Map<string, string[]>();
    for (const s of scans) {
      if (!s.caseId) continue;
      const list = scanNames.get(s.caseId);
      if (list) list.push(s.fileName);
      else scanNames.set(s.caseId, [s.fileName]);
    }

    // 3. Client display names.
    const clientIds = Array.from(new Set(eligibleRows.map(r => r.clientId).filter(Boolean)));
    const clientMap = new Map<string, string>();
    if (clientIds.length > 0) {
      const clientRows = await db
        .select({ id: profiles.id, labName: profiles.labName, fullName: profiles.fullName, email: users.email })
        .from(profiles).innerJoin(users, eq(users.id, profiles.id))
        .where(inArray(profiles.id, clientIds));
      for (const c of clientRows) {
        clientMap.set(c.id, c.labName || c.fullName || c.email || '—');
      }
    }

    const eligibleCases: EligibleCase[] = eligibleRows.map(r => ({
      id: r.id,
      caseNumber: r.caseNumber,
      category: r.category,
      scanFileNames: scanNames.get(r.id) ?? [],
      clientDisplayName: r.clientId ? (clientMap.get(r.clientId) ?? null) : null,
      qcId: r.qcId ?? null,
    }));

    // 4. Match each file. Two files landing on the same case is resolved in the UI, which sees the whole batch.
    const results = files.map(f => ({ tempId: f.tempId, fileName: f.fileName, ...matchFile(f.fileName, eligibleCases) }));

    return NextResponse.json({ results, eligibleCases });
  } catch (error: unknown) {
    console.error('Bulk match route error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
