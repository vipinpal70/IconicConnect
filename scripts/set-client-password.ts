import 'dotenv/config';
import { db } from '../src/db';
import { profiles } from '../src/db/schema/profile';
import { supabaseAdmin } from '../src/lib/supabase/admin';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

/**
 * Sets a client's login password by email.
 *
 * Tries the official Supabase Admin API first (auth.admin.updateUserById).
 * That call only works when SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL
 * point at the same Supabase project the user actually lives in. In this repo's
 * current .env they don't (see the "two different Supabase projects" issue) —
 * so this falls back to updating auth.users.encrypted_password directly via
 * DATABASE_URL, using the same bcrypt scheme Supabase's own GoTrue uses
 * ($2a$10$..., via the pgcrypto extension). Either way, all of the user's
 * existing sessions are revoked so the old password stops working everywhere.
 *
 * Usage: npx tsx scripts/set-client-password.ts <email> <newPassword>
 */

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('\x1b[31m%s\x1b[0m', 'Usage: npx tsx scripts/set-client-password.ts <email> <newPassword>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('\x1b[31m%s\x1b[0m', '❌ Password must be at least 8 characters.');
    process.exit(1);
  }

  console.log(`\n=== Looking up client: "${email}" ===\n`);

  const [profile] = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);

  if (!profile) {
    console.error('\x1b[31m%s\x1b[0m', `❌ No profile found for email: "${email}"`);
    process.exit(1);
  }
  if (profile.role !== 'client') {
    console.error(
      '\x1b[31m%s\x1b[0m',
      `❌ This email belongs to a "${profile.role}" account, not a client. Refusing to reset it from this script.`
    );
    process.exit(1);
  }

  console.log('\x1b[32m%s\x1b[0m', 'Found client:');
  console.log(`  ID: ${profile.id}`);
  console.log(`  Lab: ${profile.labName || 'N/A'}`);
  console.log(`  Status: ${profile.status}`);

  // 1. Try the official Admin API first.
  const { error: apiError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password });

  if (!apiError) {
    console.log('\x1b[32m%s\x1b[0m', '\n✅ Password updated via Supabase Admin API.');
  } else {
    console.warn(
      '\x1b[33m%s\x1b[0m',
      `\n⚠️  Admin API failed (${apiError.message}) — falling back to a direct database update.`
    );

    const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
    try {
      const updated = await sql`
        UPDATE auth.users
        SET encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf', 10)),
            updated_at = now()
        WHERE id = ${profile.id}
        RETURNING id
      `;
      if (updated.length === 0) {
        console.error('\x1b[31m%s\x1b[0m', '❌ No matching auth.users row found — nothing was updated.');
        await sql.end();
        process.exit(1);
      }
      console.log('\x1b[32m%s\x1b[0m', '✅ Password updated directly in auth.users.');
    } catch (dbErr: any) {
      console.error('\x1b[31m%s\x1b[0m', `❌ Direct database update failed: ${dbErr.message || dbErr}`);
      await sql.end();
      process.exit(1);
    }

    // 2. Revoke existing sessions so the old password/session can't keep working.
    try {
      const revoked = await sql`DELETE FROM auth.sessions WHERE user_id = ${profile.id} RETURNING id`;
      console.log(`✅ Revoked ${revoked.length} existing session(s) for this client.`);
    } catch (err: any) {
      console.warn('\x1b[33m%s\x1b[0m', `⚠️  Could not revoke existing sessions: ${err.message || err}`);
    }

    await sql.end();
  }

  console.log('\n=== Done ===\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
