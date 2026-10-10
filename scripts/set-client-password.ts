import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { profiles, users } from '../src/db/schema/profile';
import { setPassword } from '../src/lib/auth/auth-service';

/**
 * Sets a client's login password by email (hashes with argon2id and revokes every live session).
 *
 * Usage: npx tsx scripts/set-client-password.ts <email> <newPassword>
 */
async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npx tsx scripts/set-client-password.ts <email> <newPassword>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    process.exit(1);
  }

  const [row] = await db
    .select({ id: profiles.id, role: profiles.role, labName: profiles.labName, status: profiles.status })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);

  if (!row) { console.error(`❌ No account found for email: "${email}"`); process.exit(1); }
  if (row.role !== 'client') {
    console.error(`❌ This email belongs to a "${row.role}" account, not a client. Refusing to reset it from this script.`);
    process.exit(1);
  }

  console.log(`Found client ${row.id} (${row.labName || 'N/A'}, ${row.status})`);
  await setPassword(row.id, password);
  console.log('✅ Password updated; existing sessions revoked.');
  process.exit(0);
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
