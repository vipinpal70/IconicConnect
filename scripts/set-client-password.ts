import 'dotenv/config';
import { db } from '../src/db';
import { profiles } from '../src/db/schema/profile';
import { eq } from 'drizzle-orm';
import { setPassword } from '../src/lib/auth/auth-service';

/**
 * Sets a client's login password by email.
 *
 * Updates the local credential record and revokes all Redis-backed sessions.
 *
 * Usage: npx tsx scripts/set-client-password.ts <email> <newPassword>
 */

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('\x1b[31m%s\x1b[0m', 'Usage: npx tsx scripts/set-client-password.ts <email> <newPassword>');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('\x1b[31m%s\x1b[0m', '❌ Password must be at least 10 characters.');
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

  const updated = await setPassword(profile.id, password);
  if (!updated) {
    console.error('\x1b[31m%s\x1b[0m', '❌ No local credential found. Run the credential migration first.');
    process.exit(1);
  }
  console.log('\x1b[32m%s\x1b[0m', '\n✅ Password updated and existing sessions revoked.');

  console.log('\n=== Done ===\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
