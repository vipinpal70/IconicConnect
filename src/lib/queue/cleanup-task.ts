import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { db } from '../../db';
import { caseFiles, cases } from '../../db/schema/case';
import { chatMessages } from '../../db/schema/chat';
import { isNotNull } from 'drizzle-orm';

const BUCKET = 'case-files';
const GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour

function extractStoragePath(publicUrl: string, supabaseUrl: string): string | null {
  const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`;
  if (!publicUrl.startsWith(prefix)) return null;
  return decodeURIComponent(publicUrl.slice(prefix.length));
}

async function listAllStorageFiles(
  supabase: SupabaseClient,
  prefix: string = ''
): Promise<Array<{ path: string; createdAt: Date | null }>> {
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) {
    if (error) console.error(`[Cleanup] Failed to list storage at "${prefix}":`, error.message);
    return [];
  }

  const results: Array<{ path: string; createdAt: Date | null }> = [];

  for (const item of data) {
    const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      // Folder — recurse
      const nested = await listAllStorageFiles(supabase, fullPath);
      results.push(...nested);
    } else {
      results.push({
        path: fullPath,
        createdAt: item.created_at ? new Date(item.created_at) : null,
      });
    }
  }

  return results;
}

export async function runCleanup() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Cleanup] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Aborting.');
    return;
  }

  // Service-role client bypasses RLS — safe for background tasks only
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  console.log(`[Cleanup] Starting storage cleanup for bucket: ${BUCKET}`);

  // 1. Collect all referenced file URLs from every table that stores files
  const [attachmentRows, caseRows, chatRows] = await Promise.all([
    db.select({ fileUrl: caseFiles.fileUrl }).from(caseFiles),
    db.select({
      outputFile: cases.outputFile,
      previewFile: cases.previewFile,
      teethLibraryFileUrl: cases.teethLibraryFileUrl,
    }).from(cases),
    db.select({ fileUrl: chatMessages.fileUrl })
      .from(chatMessages)
      .where(isNotNull(chatMessages.fileUrl)),
  ]);

  // Build a set of storage paths that are currently in use
  const referencedPaths = new Set<string>();

  const protect = (url: string | null | undefined) => {
    if (!url) return;
    const path = extractStoragePath(url, supabaseUrl);
    if (path) referencedPaths.add(path);
  };

  attachmentRows.forEach(r => protect(r.fileUrl));
  caseRows.forEach(r => {
    protect(r.outputFile);
    protect(r.previewFile);
    protect(r.teethLibraryFileUrl);
  });
  chatRows.forEach(r => protect(r.fileUrl));

  console.log(`[Cleanup] ${referencedPaths.size} file paths are protected by database references.`);

  // 2. List every file currently in storage
  const storageFiles = await listAllStorageFiles(supabase);
  console.log(`[Cleanup] ${storageFiles.length} files found in storage bucket.`);

  const now = Date.now();
  let deleted = 0;
  let skippedLinked = 0;
  let skippedRecent = 0;

  for (const file of storageFiles) {
    // Always protect files that are referenced in the database
    if (referencedPaths.has(file.path)) {
      skippedLinked++;
      continue;
    }

    // Grace period: keep files uploaded within the last hour to avoid
    // deleting files that were uploaded but whose DB record hasn't been
    // committed yet (e.g. mid-transaction or slow insert)
    if (file.createdAt && now - file.createdAt.getTime() < GRACE_PERIOD_MS) {
      skippedRecent++;
      console.log(`[Cleanup] Skipping recent unlinked file: ${file.path}`);
      continue;
    }

    const { error } = await supabase.storage.from(BUCKET).remove([file.path]);
    if (error) {
      console.error(`[Cleanup] Failed to delete ${file.path}:`, error.message);
    } else {
      console.log(`[Cleanup] Deleted orphaned file: ${file.path}`);
      deleted++;
    }
  }

  console.log(
    `[Cleanup] Complete — deleted: ${deleted}, protected (linked): ${skippedLinked}, protected (recent): ${skippedRecent}`
  );
}

// Support running directly: npx tsx src/lib/queue/cleanup-task.ts
if (require.main === module) {
  runCleanup().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
