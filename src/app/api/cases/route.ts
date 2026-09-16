import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db';
import { cases, caseFiles, caseReferenceFiles, CASE_STATUS_TO_LIFECYCLE_STEP, CLIENT_STATUS_LABELS, caseStatusEnum, serviceTypeEnum } from '@/src/db/schema/case';
import { profiles, subUsers } from '@/src/db/schema/profile';
import { createClient } from '@/src/lib/supabase/server';
import { eq, and, or, inArray, ilike, gte, lte, sql, asc, desc, type SQL } from 'drizzle-orm';
import { isValidRoleForType } from '@/src/lib/auth/role';
import { getCasePrefix, formatCaseNumber } from '@/src/lib/case-utils';
import { logActivity } from '@/src/lib/activity-log';
import { notifyCaseSubmitted } from '@/src/lib/notifications/notification-dispatcher';
import { getCasesChatMetadata } from '@/src/lib/chat';
import { invalidateCasesCache, getCachedData, setCachedData } from '@/src/lib/redis-cache';
import { parseCatalogServiceType, getPriceListForClient, type CatalogServiceType, type PriceListEntryFull } from '@/src/lib/price-list';
import { getRequiredServiceSelections } from '@/src/lib/case-hierarchy';
import { getProfileLabName } from '@/src/lib/profile-utils';
import { resolveDuplicates, normalizeCaseFileName, type ActiveCaseKey } from '@/src/lib/case-duplicate';

const CASES_LIST_TTL = 300 // 5 minutes

// Statuses before a case reaches a finished state (Approved/Delivered) or a
// dead end (Cancelled/Client Rejected) — i.e. everything not yet 'Completed'
// on the client-facing lifecycle. Re-uploading the same file while an
// earlier case is still in one of these is blocked as a likely duplicate.
const ACTIVE_CASE_STATUSES = caseStatusEnum.enumValues.filter(
  (status) => CASE_STATUS_TO_LIFECYCLE_STEP[status] !== 'Completed'
);

const caseListSelection = {
  id: cases.id,
  clientId: cases.clientId,
  subuserId: cases.subuserId,
  caseNumber: cases.caseNumber,
  category: cases.category,
  subTypeData: cases.subTypeData,
  status: cases.status,
  serviceType: cases.serviceType,
  holdReason: cases.holdReason,
  cancelReason: cases.cancelReason,
  feedbackReason: cases.feedbackReason,
  rejectReason: cases.rejectReason,
  designerId: cases.designerId,
  qcId: cases.qcId,
  accountManagerId: cases.accountManagerId,
  startTime: cases.startTime,
  deliveredTime: cases.deliveredTime,
  tat: cases.tat,
  dueDate: cases.dueDate,
  createdAt: cases.createdAt,
  updatedAt: cases.updatedAt,
  outputFile: cases.outputFile,
  previewFile: cases.previewFile,
  preferredTeethLibrary: cases.preferredTeethLibrary,
  teethLibraryFileUrl: cases.teethLibraryFileUrl,
  teethLibraryFileName: cases.teethLibraryFileName,
  createdBy: cases.createdBy,
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

type CasePayload = {
  clientId?: string;
  category?: string;
  subTypeData?: Record<string, unknown>;
  dueDate?: string;
  // 3Shape XML Import only (xml-work-plan.md §9 / Q2): when true, an entry whose
  // zip name + tooth selection matches an existing ACTIVE case for this client
  // is silently skipped instead of 409-ing the whole request.
  skipIfDuplicate?: boolean;
  // 3Shape XML Import only: the client saw the "looks like a duplicate" flag on
  // this entry and chose to create it anyway — bypass BOTH the strict 409 and
  // the soft skip for this one entry.
  forceCreate?: boolean;
  uploadedFile?: { fileName: string; fileUrl: string; fileType: string; fileSize: number };
  uploadedFiles?: Array<{ fileName: string; fileUrl: string; fileType: string; fileSize: number }>;
  // Optional reference images (up to 5) — case-modification-plan.md §2.
  referenceImages?: Array<{ fileName: string; fileUrl: string; fileType: string; fileSize: number }>;
  preferredTeethLibrary?: string;
  teethLibraryFileUrl?: string | null;
  teethLibraryFileName?: string | null;
  [key: string]: unknown;
};


export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const contentType = req.headers.get('content-type') || '';
    let casesData: unknown;
    let files: File[] = [];

    if (contentType.includes('application/json')) {
      // Mobile / API-client path: raw JSON body (single case object or array)
      casesData = await req.json().catch(() => null);
      if (!casesData) {
        return NextResponse.json({ error: 'No cases data provided' }, { status: 400 });
      }
    } else {
      // Browser FormData path (existing web clients)
      const formData = await req.formData();
      const casesJson = formData.get('cases') as string;
      files = formData.getAll('files') as File[];
      if (!casesJson) {
        return NextResponse.json({ error: 'No cases data provided' }, { status: 400 });
      }
      casesData = JSON.parse(casesJson);
    }

    const isArray = Array.isArray(casesData);
    const casesArray: CasePayload[] = isArray
      ? (casesData as CasePayload[])
      : [casesData as CasePayload];

    let clientId: string | undefined;
    let subuserId: string | null = null;

    // We assume the first case's clientId or profile determines the client for the batch
    const firstCase = casesArray[0];

    if (isValidRoleForType('admin_portal', profile.role)) {
      if (!firstCase.clientId) {
        return NextResponse.json({ error: 'Client ID is required for admins creating a case' }, { status: 400 });
      }
      clientId = firstCase.clientId;
    } else if (profile.role === 'client') {
      clientId = profile.id;
    } else if (profile.role === 'subuser') {
      const subUserRecord = await db.select().from(subUsers).where(eq(subUsers.id, profile.id)).limit(1);
      if (!subUserRecord.length) {
        return NextResponse.json({ error: 'Subuser parent client not found' }, { status: 400 });
      }
      clientId = subUserRecord[0].clientId;
      subuserId = profile.id;
    } else {
      return NextResponse.json({ error: 'Unauthorized to create a case' }, { status: 403 });
    }

    if (!clientId) {
      return NextResponse.json({ error: 'Failed to determine Client ID' }, { status: 400 });
    }

    const caseFileNames = (c: CasePayload): string[] => {
      const names: string[] = [];
      if (c.uploadedFile?.fileName) names.push(c.uploadedFile.fileName);
      if (Array.isArray(c.uploadedFiles)) {
        for (const uf of c.uploadedFiles) if (uf.fileName) names.push(uf.fileName);
      }
      return names;
    };
    const payloadTeeth = (c: CasePayload): number[] => {
      const t = (c.subTypeData as { teeth?: unknown } | undefined)?.teeth;
      return Array.isArray(t) ? (t as number[]) : [];
    };

    // Entries the 3Shape import flow marks skippable — a name+tooth match against
    // an active case (or an earlier entry in this batch) drops just that entry.
    let skipIndices = new Set<number>();
    let skipped: Array<{ fileName: string; teeth: number[]; existingCaseNumber: string | null }> = [];

    // Block a client/subuser from resubmitting a case file that's already
    // being worked on in one of their own active (non-finished) cases.
    if (profile.role === 'client' || profile.role === 'subuser') {
      // --- strict path: any file collision 409s the whole request (unchanged).
      // 3Shape-import entries opt out via skipIfDuplicate; a forced entry (the
      // client dismissed the duplicate flag) opts out too. ---
      const strictFileNames = Array.from(new Set(
        casesArray.filter((c) => !c.skipIfDuplicate && !c.forceCreate).flatMap(caseFileNames)
      ));
      if (strictFileNames.length > 0) {
        const duplicate = await db
          .select({ fileName: caseFiles.fileName, caseNumber: cases.caseNumber, status: cases.status })
          .from(caseFiles)
          .innerJoin(cases, eq(caseFiles.caseId, cases.id))
          .where(and(
            inArray(caseFiles.fileName, strictFileNames),
            eq(cases.clientId, clientId),
            inArray(cases.status, ACTIVE_CASE_STATUSES)
          ))
          .limit(1)
          .then(res => res[0]);

        if (duplicate) {
          return NextResponse.json({
            error: `The file "${duplicate.fileName}" was already uploaded in case ${duplicate.caseNumber || ''} (${CLIENT_STATUS_LABELS[duplicate.status]}). Please wait for that case to finish before resubmitting the same file.`
          }, { status: 409 });
        }
      }

      // --- soft path: 3Shape import — skip an entry that duplicates an active
      // case by zip name + tooth-selection overlap (xml-work-plan.md §9). ---
      const softEntries = casesArray
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.skipIfDuplicate === true && caseFileNames(c).length > 0);

      if (softEntries.length > 0) {
        const activeRows = await db
          .select({ id: cases.id, caseNumber: cases.caseNumber, subTypeData: cases.subTypeData })
          .from(cases)
          .where(and(eq(cases.clientId, clientId), inArray(cases.status, ACTIVE_CASE_STATUSES)));

        const activeIds = activeRows.map((r) => r.id);
        const earliestName = new Map<string, string>();
        if (activeIds.length > 0) {
          const rows = await db
            .select({ caseId: caseFiles.caseId, fileName: caseFiles.fileName })
            .from(caseFiles)
            .where(inArray(caseFiles.caseId, activeIds))
            .orderBy(asc(caseFiles.createdAt));
          for (const row of rows) {
            if (row.caseId && !earliestName.has(row.caseId)) earliestName.set(row.caseId, row.fileName);
          }
        }
        const activeByName = new Map<string, ActiveCaseKey[]>();
        for (const r of activeRows) {
          const fn = earliestName.get(r.id);
          if (!fn) continue;
          const teethArr = (r.subTypeData as { teeth?: unknown } | null)?.teeth;
          const teeth = new Set<number>(Array.isArray(teethArr) ? (teethArr as number[]) : []);
          const key = normalizeCaseFileName(fn);
          const bucket = activeByName.get(key) ?? [];
          bucket.push({ caseNumber: r.caseNumber, teeth });
          activeByName.set(key, bucket);
        }

        const resolution = resolveDuplicates(
          softEntries.map(({ c, i }) => ({
            index: i,
            fileName: caseFileNames(c)[0],
            teeth: payloadTeeth(c),
          })),
          activeByName,
        );
        skipIndices = resolution.skipIndices;
        skipped = resolution.skipped;
      }
    }

    // Fetch client profile to get lab name for folder structure
    const clientProfile = await db.select().from(profiles).where(eq(profiles.id, clientId)).limit(1).then(res => res[0]);
    const labName = getProfileLabName(clientProfile);
    const enabledServiceTypes = clientProfile?.enabledServiceTypes ?? ['design_only'];
    const modelOnlyLab = clientProfile?.modelOnlyLab ?? false;

    const results = [];

    // Ensure sequence exists once before generating next values
    await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS cases_number_seq START 1`);

    // Per (flow) price list, fetched at most once per distinct serviceType in
    // this batch rather than once per case.
    const priceListByServiceType = new Map<CatalogServiceType, PriceListEntryFull[]>();

    for (let i = 0; i < casesArray.length; i++) {
      if (skipIndices.has(i)) continue;
      const caseData = casesArray[i];
      const file = files[i];

      const serviceType = parseCatalogServiceType(typeof caseData.serviceType === 'string' ? caseData.serviceType : null)
      if (!enabledServiceTypes.includes(serviceType)) {
        return NextResponse.json(
          { error: `The ${serviceType} flow is not enabled for this client` },
          { status: 400 }
        );
      }

      if (modelOnlyLab && caseData.category !== '3D Model') {
        return NextResponse.json(
          { error: 'This lab is restricted to 3D Model cases only' },
          { status: 400 }
        );
      }

      // Server-side enforcement of case-modification-plan.md §1 & §3 — the
      // authoritative guard, since it also protects the raw JSON/mobile-client
      // path that bypasses every web form's client-side validation.
      if (!caseData.category) {
        return NextResponse.json({ error: 'Category is required.' }, { status: 400 });
      }
      const hasFile = Boolean(caseData.uploadedFile)
        || (Array.isArray(caseData.uploadedFiles) && caseData.uploadedFiles.length > 0)
        || Boolean(file);
      if (!hasFile) {
        return NextResponse.json({ error: 'At least one case file is required.' }, { status: 400 });
      }
      const subTypeDataForCheck = (caseData.subTypeData as { caseType?: unknown; caseType1?: unknown; teeth?: unknown; die?: unknown; modelRequired?: unknown } | undefined) || {};
      // The primary "Case Type" selector — every category's hierarchy names it
      // either `caseType` or `caseType1`, so checking both generically works
      // regardless of which form submitted the request. Kept required (unlike
      // secondary sub-type fields) because it's exactly what
      // getRequiredServiceSelections/the price-list "isEnabled" check just
      // below validates against — a blank primary field has nothing to check
      // and would otherwise silently bypass that restriction.
      if (!subTypeDataForCheck.caseType && !subTypeDataForCheck.caseType1) {
        return NextResponse.json({ error: 'Case type is required.' }, { status: 400 });
      }
      // Teeth are optional for 3D Model unless Die = Yes (3d-model-implement-plan.md §8).
      const teethOk = caseData.category === '3D Model'
        ? subTypeDataForCheck.die !== 'Yes' || (Array.isArray(subTypeDataForCheck.teeth) && subTypeDataForCheck.teeth.length > 0)
        : Array.isArray(subTypeDataForCheck.teeth) && subTypeDataForCheck.teeth.length > 0;
      if (!teethOk) {
        return NextResponse.json({ error: 'At least one tooth selection is required.' }, { status: 400 });
      }
      // modelRequired doesn't apply to 3D Model; everywhere else the lab must
      // actively pick Yes/No.
      if (caseData.category !== '3D Model' && subTypeDataForCheck.modelRequired !== 'yes' && subTypeDataForCheck.modelRequired !== 'no') {
        return NextResponse.json(
          { error: 'Please specify whether a model is required for this case.' },
          { status: 400 }
        );
      }
      if (Array.isArray(caseData.referenceImages) && caseData.referenceImages.length > 5) {
        return NextResponse.json(
          { error: 'A maximum of 5 reference images is allowed per case.' },
          { status: 400 }
        );
      }

      // Reject if this client doesn't have access to the specific
      // category/sub-type selected — admin can disable an individual
      // service (system-wide via service_catalog.isActive, or per-client
      // via client_price_list.isEnabled) independently of the flow toggle
      // checked above.
      const requiredSelections = getRequiredServiceSelections(caseData.category ?? '', caseData.subTypeData);
      if (requiredSelections.length > 0) {
        if (!priceListByServiceType.has(serviceType)) {
          priceListByServiceType.set(serviceType, await getPriceListForClient(clientId, serviceType));
        }
        const priceList = priceListByServiceType.get(serviceType)!;
        const hasDisabledSelection = requiredSelections.some(
          (sel) => !priceList.some((row) => row.category === sel.category && row.subCategory === sel.subCategory && row.isEnabled)
        );
        if (hasDisabledSelection) {
          return NextResponse.json(
            { error: 'This service is not available for your account. Please contact support.' },
            { status: 400 }
          );
        }
      }

      const seqResult = await db.execute(sql`SELECT nextval('cases_number_seq') AS n`)
      // drizzle-orm/postgres-js returns rows as a RowList (array-like); handle both shapes
      const seqResultShape = seqResult as unknown as { rows?: Record<string, unknown>[] } & Record<string, unknown>[]
      const seqRow = (Array.isArray(seqResult) ? seqResultShape[0] : seqResultShape.rows?.[0] ?? seqResultShape[0]) as Record<string, unknown>
      const seqNum = Number(seqRow?.n ?? 1)
      const caseNumber = formatCaseNumber(getCasePrefix(caseData.category ?? ''), seqNum)

      const newCase = {
        clientId,
        subuserId,
        caseNumber,
        dueDate: caseData.dueDate ? new Date(caseData.dueDate) : null,
        category: caseData.category,
        subTypeData: caseData.subTypeData,
        preferredTeethLibrary: caseData.preferredTeethLibrary || 'default',
        teethLibraryFileUrl: caseData.teethLibraryFileUrl || null,
        teethLibraryFileName: caseData.teethLibraryFileName || null,
        serviceType,
        createdBy: profile.fullName || profile.email || 'System',
      };

      const insertedCase = await db.insert(cases).values(newCase).returning().then(res => res[0]);

      notifyCaseSubmitted({
        actorUserId: user.id,
        caseId: insertedCase.id,
        caseNumber: insertedCase.caseNumber ?? '',
        category: insertedCase.category ?? '',
        clientName: clientProfile?.labName || clientProfile?.fullName || clientProfile?.email || 'Client',
      }).catch((err) => console.error('[CaseNotificationTrigger] Failed to dispatch case submission notification:', err));

      if (caseData.uploadedFiles && Array.isArray(caseData.uploadedFiles)) {
        for (const uf of caseData.uploadedFiles) {
          await db.insert(caseFiles).values({
            caseId: insertedCase.id,
            uploadedBy: user.id,
            fileName: uf.fileName,
            fileUrl: uf.fileUrl,
            fileType: uf.fileType ?? null,
            fileSize: uf.fileSize ? Number(uf.fileSize) : null,
          });
        }
      } else if (caseData.uploadedFile) {
        // Already uploaded immediately by client (fallback single file)
        await db.insert(caseFiles).values({
          caseId: insertedCase.id,
          uploadedBy: user.id,
          fileName: caseData.uploadedFile.fileName,
          fileUrl: caseData.uploadedFile.fileUrl,
          fileType: caseData.uploadedFile.fileType ?? null,
          fileSize: caseData.uploadedFile.fileSize ? Number(caseData.uploadedFile.fileSize) : null,
        });
      } else if (file) {
        // Legacy/Direct fallback upload
        const storagePath = `case_data/${labName}/${caseNumber}/${file.name}`;

        const { error: uploadError } = await supabase
          .storage
          .from('case-files')
          .upload(storagePath, file, { upsert: true });

        if (uploadError) {
          console.error(`Failed to upload file for case ${caseNumber}:`, uploadError);
        } else {
          const { data: publicUrlData } = supabase
            .storage
            .from('case-files')
            .getPublicUrl(storagePath);

          await db.insert(caseFiles).values({
            caseId: insertedCase.id,
            uploadedBy: user.id,
            fileName: file.name,
            fileUrl: publicUrlData.publicUrl,
            fileType: file.type,
            fileSize: file.size,
          });
        }
      }

      if (Array.isArray(caseData.referenceImages)) {
        for (const img of caseData.referenceImages) {
          await db.insert(caseReferenceFiles).values({
            caseId: insertedCase.id,
            uploadedBy: user.id,
            fileName: img.fileName,
            fileUrl: img.fileUrl,
            fileType: img.fileType ?? null,
            fileSize: img.fileSize ? Number(img.fileSize) : null,
          });
        }
      }

      logActivity({
        actor: profile,
        action: 'case.created',
        caseId: insertedCase.id,
        details: {
          caseNumber: insertedCase.caseNumber,
          category: insertedCase.category,
          clientId: insertedCase.clientId,
          subuserId: insertedCase.subuserId,
          status: insertedCase.status,
          hasUploadedFile: Boolean(caseData.uploadedFile || file),
        },
      }).catch((err) => console.error('[CaseActivityLog] Failed to log activity:', err));

      results.push(insertedCase);
    }

    if (clientId) {
      await invalidateCasesCache(clientId);
    }

    // `skipped` is always present but empty unless a 3Shape-import entry was
    // dropped as a duplicate — existing callers read `data` only.
    return NextResponse.json({ data: isArray ? results : results[0], skipped }, { status: 201 });
  } catch (error: unknown) {
    const err = error as Record<string, unknown>
    const cause = err?.cause as Record<string, unknown> | undefined
    const message      = getErrorMessage(error)
    const causeMessage = cause ? String(cause.message ?? '') : undefined
    const detail       = (err?.detail ?? cause?.detail) as string | undefined
    const code         = (err?.code   ?? cause?.code)   as string | undefined
    const constraint   = (err?.constraint ?? cause?.constraint) as string | undefined
    console.error('Create case error:', { message, causeMessage, detail, code, constraint })
    return NextResponse.json({ error: causeMessage || message, detail, code, constraint }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileResult = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const profile = profileResult[0];

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);

    const isAdmin = isValidRoleForType('admin_portal', profile.role)
    const cacheClientId = profile.role === 'subuser' ? (profile.createdBy ?? profile.id) : profile.id

    // Hard row ceiling — 300 for the admin console, 200 for the lab / ops
    // portals — so neither the query nor the browser list can grow unbounded.
    // The pages default to and page in CASES_PAGE_SIZE (100) rows.
    const maxRows = isAdmin ? 300 : 200;
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), maxRows);
    const page = Math.max(Number(searchParams.get('page') || 1), 1);
    const offset = (page - 1) * limit;

    // ── Server-side list filters ────────────────────────────────────────────
    // Every filter the cases pages expose is now applied here (triggered by the
    // "Fetch" button) rather than in the browser over a pre-loaded page, so a
    // filtered view spans every case. All are optional and AND-ed together.
    //   search      — case #, category, sub-type, client/lab name, file name
    //   statuses    — CSV of case_status enum values (pages send the mapped set)
    //   serviceType — design_only | design_milling | milling_only
    //   category    — exact case category
    //   clientId    — exact owning client (admin only; others are auto-scoped)
    //   assignedTo  — "me"/"mine" or a user id; matches designer OR qc
    //   from / to   — inclusive createdAt date range (YYYY-MM-DD, UTC)
    const searchTerm = (searchParams.get('search') || '').trim().slice(0, 100);
    const hasSearch = searchTerm.length > 0;

    const statuses = (searchParams.get('statuses') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is typeof caseStatusEnum.enumValues[number] =>
        (caseStatusEnum.enumValues as readonly string[]).includes(s));

    const serviceTypeParam = searchParams.get('serviceType');
    const serviceType = (serviceTypeEnum.enumValues as readonly string[]).includes(serviceTypeParam ?? '')
      ? (serviceTypeParam as typeof serviceTypeEnum.enumValues[number])
      : null;

    const categoryParam = (searchParams.get('category') || '').trim() || null;
    const clientIdParam = (searchParams.get('clientId') || '').trim() || null;

    const assignedParam = (searchParams.get('assignedTo') || '').trim();
    // "me" / "mine" (the pages' own value) both mean the current user.
    const assignedUserId = assignedParam === 'me' || assignedParam === 'mine'
      ? profile.id
      : (assignedParam || null);

    const parseBoundary = (value: string | null, endOfDay: boolean): Date | null => {
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const d = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const fromDate = parseBoundary(searchParams.get('from'), false);
    const toDate = parseBoundary(searchParams.get('to'), true);

    const hasFilters =
      hasSearch || statuses.length > 0 || !!serviceType || !!categoryParam ||
      !!clientIdParam || !!assignedUserId || !!fromDate || !!toDate;

    // Cache key (role + page + resolved limit)
    const casesCacheKey = isAdmin
      ? `cases:list:admin:p${page}:l${limit}`
      : `cases:list:client:${cacheClientId}:p${page}:l${limit}`

    // Filtered views bypass the list cache — one entry per filter combination
    // would flood Redis and slip past invalidateCasesCache().
    const cachedCases = hasFilters
      ? null
      : await getCachedData<{ data: unknown[]; hasMore: boolean }>(casesCacheKey)
    if (cachedCases) return NextResponse.json(cachedCases)

    // Build the search predicate. The file-name and client-name matches are
    // resolved to id lists up front — each a single index-backed query (the
    // file-name one rides the case_files trigram index from migration 0052) —
    // so the main case query stays a plain `id IN (...)` rather than a
    // per-row correlated sub-select.
    let searchCondition: SQL | undefined;
    if (hasSearch) {
      const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
      const likePattern = `%${escapeLike(searchTerm)}%`;
      const likePatternLower = likePattern.toLowerCase();

      const [fileCaseIdRows, clientIdRows] = await Promise.all([
        db.selectDistinct({ caseId: caseFiles.caseId })
          .from(caseFiles)
          .where(sql`lower(${caseFiles.fileName}) like ${likePatternLower}`)
          .limit(5000),
        db.select({ id: profiles.id })
          .from(profiles)
          .where(or(
            ilike(profiles.labName, likePattern),
            ilike(profiles.fullName, likePattern),
            ilike(profiles.email, likePattern),
          ))
          .limit(2000),
      ]);

      const matchedFileCaseIds = fileCaseIdRows
        .map((r) => r.caseId)
        .filter((v): v is string => Boolean(v));
      const matchedClientIds = clientIdRows.map((r) => r.id);

      searchCondition = or(
        ilike(cases.caseNumber, likePattern),
        ilike(cases.category, likePattern),
        sql`${cases.subTypeData}::text ilike ${likePattern}`,
        matchedFileCaseIds.length ? inArray(cases.id, matchedFileCaseIds) : undefined,
        matchedClientIds.length ? inArray(cases.clientId, matchedClientIds) : undefined,
      );
    }

    // Combine every active filter into one AND-ed predicate.
    const filterParts: (SQL | undefined)[] = [
      searchCondition,
      statuses.length > 0 ? inArray(cases.status, statuses) : undefined,
      serviceType ? eq(cases.serviceType, serviceType) : undefined,
      categoryParam ? eq(cases.category, categoryParam) : undefined,
      clientIdParam ? eq(cases.clientId, clientIdParam) : undefined,
      assignedUserId
        ? or(eq(cases.designerId, assignedUserId), eq(cases.qcId, assignedUserId))
        : undefined,
      fromDate ? gte(cases.createdAt, fromDate) : undefined,
      toDate ? lte(cases.createdAt, toDate) : undefined,
    ];
    const filterCondition = and(...filterParts);

    // Fetch one extra row to determine whether another page exists
    const fetchLimit = limit + 1;

    let results;

    if (isAdmin) {
      results = await db.select(caseListSelection).from(cases)
        .where(filterCondition)
        .orderBy(desc(cases.createdAt))
        .limit(fetchLimit)
        .offset(offset);
    } else if (profile.role === 'client') {
      results = await db.select(caseListSelection).from(cases)
        .where(and(eq(cases.clientId, profile.id), filterCondition))
        .orderBy(desc(cases.createdAt))
        .limit(fetchLimit)
        .offset(offset);
    } else if (profile.role === 'subuser') {
      results = await db.select(caseListSelection).from(cases)
        .where(and(eq(cases.clientId, cacheClientId), filterCondition))
        .orderBy(desc(cases.createdAt))
        .limit(fetchLimit)
        .offset(offset);
    } else {
      return NextResponse.json({ error: 'Unauthorized role' }, { status: 403 });
    }

    // Determine hasMore before trimming the extra row
    const hasMore = results.length > limit;
    if (hasMore) results = results.slice(0, limit);

    // These four lookups only depend on `results`, not on each other — run them
    // concurrently instead of paying for four sequential DB round trips.
    const designerIds = Array.from(new Set(results.map(r => r.designerId).filter(Boolean))) as string[];
    const clientIds = Array.from(new Set(results.map(r => r.clientId).filter(Boolean))) as string[];
    const caseIds = results.map((r) => r.id);

    const [designersProfiles, clientsProfiles, chatMetadata, fileRows] = await Promise.all([
      designerIds.length > 0
        ? db.select().from(profiles).where(inArray(profiles.id, designerIds))
        : Promise.resolve([]),
      clientIds.length > 0
        ? db.select().from(profiles).where(inArray(profiles.id, clientIds))
        : Promise.resolve([]),
      getCasesChatMetadata(caseIds, profile.id),
      caseIds.length > 0
        ? db.select({ caseId: caseFiles.caseId, fileName: caseFiles.fileName })
            .from(caseFiles)
            .where(inArray(caseFiles.caseId, caseIds))
            .orderBy(asc(caseFiles.createdAt))
        : Promise.resolve([]),
    ]);

    const designersMap = new Map<string, string>();
    designersProfiles.forEach(p => {
      designersMap.set(p.id, p.fullName || p.email);
    });

    const clientsMap = new Map<string, string>();
    clientsProfiles.forEach(p => {
      clientsMap.set(p.id, p.labName || p.fullName || p.email || '—');
    });

    // Fetch first uploaded scan file name for each case
    const scanFileMap = new Map<string, string>();
    for (const row of fileRows) {
      if (row.caseId && !scanFileMap.has(row.caseId)) {
        scanFileMap.set(row.caseId, row.fileName);
      }
    }

    const mappedResults = results.map(r => ({
      ...r,
      designerName: r.designerId ? (designersMap.get(r.designerId) || null) : null,
      clientDisplayName: r.clientId ? (clientsMap.get(r.clientId) || null) : null,
      todayMessagesCount: chatMetadata.get(r.id)?.todayMessagesCount ?? 0,
      hasUnreadChat: chatMetadata.get(r.id)?.hasUnreadChat ?? false,
      scanFileName: scanFileMap.get(r.id) ?? null,
    }));

    const payload = { data: mappedResults, hasMore }
    if (!hasFilters) await setCachedData(casesCacheKey, payload, CASES_LIST_TTL)
    return NextResponse.json(payload);
  } catch (error: unknown) {
    console.error('Get cases error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
