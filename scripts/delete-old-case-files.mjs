import 'dotenv/config'
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {};
}
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

function getStoragePathFromUrl(url) {
  const marker = '/case-files/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.substring(idx + marker.length));
}

async function main() {
  console.log('=== Starting Cleanup of Case Files Older Than 3 Months ===\n');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('❌ NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined in the environment.');
  }
  if (!databaseUrl) {
    throw new Error('❌ DATABASE_URL is not defined in the environment.');
  }

  // Initialize clients
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1
  });

  // Calculate cutoff date (3 months ago)
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  console.log(`Cutoff date: ${threeMonthsAgo.toISOString()} (files uploaded before this will be deleted)\n`);

  try {
    // Query files older than 3 months
    const oldFiles = await sql`
      SELECT id, file_name, file_url, created_at
      FROM case_files
      WHERE created_at <= ${threeMonthsAgo.toISOString()}
    `;

    console.log(`Found ${oldFiles.length} file(s) to delete.`);

    let successCount = 0;
    let failCount = 0;

    for (const file of oldFiles) {
      console.log(`\nProcessing file: "${file.file_name}" (ID: ${file.id}, Uploaded: ${new Date(file.created_at).toLocaleDateString()})`);

      const storagePath = getStoragePathFromUrl(file.file_url);

      if (!storagePath) {
        console.warn(`⚠️ Could not parse storage path from URL: ${file.file_url}. Skipping storage deletion.`);
      } else {
        console.log(`Deleting from Supabase Storage: "${storagePath}"...`);
        const { error: storageError } = await supabase.storage
          .from('case-files')
          .remove([storagePath]);

        if (storageError) {
          console.error(`❌ Failed to delete storage object: ${storageError.message}`);
        } else {
          console.log(`✅ Deleted from Supabase Storage.`);
        }
      }

      console.log(`Deleting record from database...`);
      try {
        await sql`
          DELETE FROM case_files
          WHERE id = ${file.id}
        `;
        console.log(`✅ Deleted database record.`);
        successCount++;
      } catch (dbErr) {
        console.error(`❌ Failed to delete database record: ${dbErr.message}`);
        failCount++;
      }
    }

    console.log(`\n----------------------------------------`);
    console.log(`Cleanup complete!`);
    console.log(`- Total processed: ${oldFiles.length}`);
    console.log(`- Successfully deleted: ${successCount}`);
    console.log(`- Failed: ${failCount}`);

  } catch (err) {
    console.error('❌ Error during cleanup:', err.message || err);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(err => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
