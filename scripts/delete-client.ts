import 'dotenv/config';
import { db } from '../src/db';
import {
  profiles,
  subUsers,
  cases,
  caseFiles,
  caseMessages,
  chatMessages,
  chatReadStates,
  notifications,
  notificationPreferences,
  activityLogs,
  invoices,
  offerClaims,
  preferenceForms,
  clientPriceList,
  sidebarSeenAt,
  supportCallbackRequests,
  supportTickets
} from '../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

const isUUID = (str: string) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
};

async function main() {
  const searchInput = process.argv[2];
  if (!searchInput) {
    console.error('\x1b[31m%s\x1b[0m', 'Usage: npx tsx scripts/delete-client.ts <client_id_or_email>');
    process.exit(1);
  }

  console.log(`\n=== Finding client with identifier: "${searchInput}" ===\n`);

  // 1. Fetch Client Profile
  let clientProfile;
  try {
    if (isUUID(searchInput)) {
      const results = await db.select().from(profiles).where(eq(profiles.id, searchInput)).limit(1);
      clientProfile = results[0];
    } else {
      const results = await db.select().from(profiles).where(eq(profiles.email, searchInput)).limit(1);
      clientProfile = results[0];
    }
  } catch (err: any) {
    console.error('\x1b[31m%s\x1b[0m', `❌ Error querying profiles: ${err.message || err}`);
    process.exit(1);
  }

  if (!clientProfile) {
    console.error('\x1b[31m%s\x1b[0m', `❌ Client not found for: "${searchInput}"`);
    process.exit(1);
  }

  if (clientProfile.role !== 'client') {
    console.warn('\x1b[33m%s\x1b[0m', `⚠️ Warning: The found profile has role "${clientProfile.role}" instead of "client".`);
  }

  const clientId = clientProfile.id;
  const clientEmail = clientProfile.email;
  const labName = clientProfile.labName;

  console.log('\x1b[32m%s\x1b[0m', `Found Client:`);
  console.log(`  ID: ${clientId}`);
  console.log(`  Email: ${clientEmail}`);
  console.log(`  Lab Name: ${labName || 'N/A'}`);
  console.log(`  Role: ${clientProfile.role}`);

  // 2. Fetch all Subusers of the Client
  let subUserIds: string[] = [];
  try {
    const subUserRecords = await db.select().from(subUsers).where(eq(subUsers.clientId, clientId));
    subUserIds = subUserRecords.map((su: any) => su.profileId);
    console.log(`Found ${subUserIds.length} subuser(s) associated with this client.`);
  } catch (err: any) {
    console.error('\x1b[31m%s\x1b[0m', `❌ Error querying subusers: ${err.message || err}`);
  }

  const allUserIds = [clientId, ...subUserIds];
  console.log(`All User IDs associated with this client: [${allUserIds.join(', ')}]`);

  // 3. Fetch all Cases of the Client
  let caseIds: string[] = [];
  try {
    const caseRecords = await db.select().from(cases).where(eq(cases.clientId, clientId));
    caseIds = caseRecords.map((c: any) => c.id);
    console.log(`Found ${caseIds.length} case(s) associated with this client.`);
  } catch (err: any) {
    console.error('\x1b[31m%s\x1b[0m', `❌ Error querying cases: ${err.message || err}`);
  }

  console.log('\n----------------------------------------\n');
  console.log('=== Cleaning Database Records ===\n');

  // a. Invoices
  try {
    await db.delete(invoices).where(eq(invoices.clientId, clientId));
    console.log(`✅ Deleted invoices for client`);
  } catch (err: any) {
    console.error(`❌ Error deleting invoices: ${err.message || err}`);
  }

  // b. Case Files
  if (caseIds.length > 0) {
    try {
      await db.delete(caseFiles).where(inArray(caseFiles.caseId, caseIds));
      console.log(`✅ Deleted case files records for ${caseIds.length} cases`);
    } catch (err: any) {
      console.error(`❌ Error deleting case files: ${err.message || err}`);
    }
  }

  // c. Case Messages
  if (caseIds.length > 0) {
    try {
      await db.delete(caseMessages).where(inArray(caseMessages.caseId, caseIds));
      console.log(`✅ Deleted case messages for ${caseIds.length} cases`);
    } catch (err: any) {
      console.error(`❌ Error deleting case messages: ${err.message || err}`);
    }
  }

  // d. Chat Messages
  if (caseIds.length > 0) {
    try {
      await db.delete(chatMessages).where(inArray(chatMessages.caseId, caseIds));
      console.log(`✅ Deleted chat messages for ${caseIds.length} cases`);
    } catch (err: any) {
      console.error(`❌ Error deleting chat messages: ${err.message || err}`);
    }
  }

  // e. Chat Read States
  if (caseIds.length > 0) {
    try {
      await db.delete(chatReadStates).where(inArray(chatReadStates.caseId, caseIds));
      console.log(`✅ Deleted chat read states for ${caseIds.length} cases`);
    } catch (err: any) {
      console.error(`❌ Error deleting chat read states: ${err.message || err}`);
    }
  }

  // f. Activity Logs
  try {
    // Delete activity logs related to user profiles
    await db.delete(activityLogs).where(inArray(activityLogs.userId, allUserIds));
    // Delete activity logs related to client's cases (if caseIds exists)
    if (caseIds.length > 0) {
      await db.delete(activityLogs).where(inArray(activityLogs.caseId, caseIds));
    }
    console.log(`✅ Deleted activity logs`);
  } catch (err: any) {
    console.error(`❌ Error deleting activity logs: ${err.message || err}`);
  }

  // g. Notifications
  try {
    await db.delete(notifications).where(inArray(notifications.userId, allUserIds));
    console.log(`✅ Deleted notifications`);
  } catch (err: any) {
    console.error(`❌ Error deleting notifications: ${err.message || err}`);
  }

  // (Notification preferences are preserved as we are keeping the user profiles)

  // i. Support Tickets
  try {
    await db.delete(supportTickets).where(eq(supportTickets.clientId, clientId));
    console.log(`✅ Deleted support tickets`);
  } catch (err: any) {
    console.error(`❌ Error deleting support tickets: ${err.message || err}`);
  }

  // j. Support Callback Requests
  try {
    await db.delete(supportCallbackRequests).where(eq(supportCallbackRequests.clientId, clientId));
    console.log(`✅ Deleted support callback requests`);
  } catch (err: any) {
    console.error(`❌ Error deleting support callback requests: ${err.message || err}`);
  }

  // k. Offer Claims
  try {
    await db.delete(offerClaims).where(eq(offerClaims.clientId, clientId));
    console.log(`✅ Deleted offer claims`);
  } catch (err: any) {
    console.error(`❌ Error deleting offer claims: ${err.message || err}`);
  }

  // l. Preference Forms
  try {
    await db.delete(preferenceForms).where(eq(preferenceForms.clientId, clientId));
    console.log(`✅ Deleted preference forms`);
  } catch (err: any) {
    console.error(`❌ Error deleting preference forms: ${err.message || err}`);
  }

  // m. Client Price List
  try {
    await db.delete(clientPriceList).where(eq(clientPriceList.clientId, clientId));
    console.log(`✅ Deleted client price lists`);
  } catch (err: any) {
    console.error(`❌ Error deleting client price lists: ${err.message || err}`);
  }

  // n. Sidebar Seen At
  try {
    await db.delete(sidebarSeenAt).where(inArray(sidebarSeenAt.userId, allUserIds));
    console.log(`✅ Deleted sidebar seen status`);
  } catch (err: any) {
    console.error(`❌ Error deleting sidebar seen status: ${err.message || err}`);
  }

  // o. Cases
  try {
    await db.delete(cases).where(eq(cases.clientId, clientId));
    console.log(`✅ Deleted cases for client`);
  } catch (err: any) {
    console.error(`❌ Error deleting cases: ${err.message || err}`);
  }

  // Note: We preserve subUsers, profiles, and Supabase Auth users as requested, only wiping their created data.

  console.log('\n----------------------------------------\n');
  console.log('=== Cleaning Local Files on Disk ===\n');

  // s. Disk Files
  if (labName) {
    try {
      const clientFilesDir = path.join(process.cwd(), 'case_data', labName);
      if (fs.existsSync(clientFilesDir)) {
        console.log(`Removing directory: ${clientFilesDir}...`);
        fs.rmSync(clientFilesDir, { recursive: true, force: true });
        console.log(`✅ Successfully deleted lab file directory: "${labName}"`);
      } else {
        console.log(`File directory "${clientFilesDir}" does not exist. Skipping file cleanup.`);
      }
    } catch (err: any) {
      console.error(`❌ Local file cleanup error: ${err.message || err}`);
    }
  } else {
    console.log('No Lab Name specified in profile. Skipping file cleanup.');
  }

  console.log('\n=== Cleanup Completed Successfully! ===\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
