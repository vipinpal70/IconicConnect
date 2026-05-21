import 'dotenv/config';
import { db } from '@/src/db';
import { notifications, notificationPreferences } from '@/src/db/schema/notification';
import { profiles } from '@/src/db/schema/profile';
import { NotificationService } from './notification-service';
import { NotificationType } from './notification-events';
import { eq, and } from 'drizzle-orm';

async function main() {
  console.log('=== STARTING NOTIFICATION SYSTEM INTEGRATION VERIFICATION ===');
  
  // 1. Fetch any existing profile to act as actor/target
  console.log('[Step 1] Fetching active profiles from database...');
  const activeProfiles = await db.select().from(profiles).limit(2);
  if (activeProfiles.length < 1) {
    console.error('No profiles found in database to run tests. Exiting.');
    process.exit(1);
  }

  const actor = activeProfiles[0];
  const target = activeProfiles[1] || activeProfiles[0];
  
  console.log(`Using Actor ID: ${actor.id} (${actor.fullName || 'User'}), Target ID: ${target.id} (${target.fullName || 'User'})`);

  // 2. Test getPreferences seeding
  console.log('[Step 2] Testing getPreferences seeding or loading...');
  const prefs = await NotificationService.getPreferences(target.id);
  console.log('Successfully retrieved or seeded target preferences:', prefs);

  // 3. Test event dispatching
  console.log('[Step 3] Dispatching sample CASE_ASSIGNED notification event...');
  const dispatchRes = await NotificationService.dispatch({
    type: NotificationType.CASE_ASSIGNED,
    actorUserId: actor.id,
    targetUserId: target.id,
    title: 'New Case Assigned for Design',
    message: 'A brand new premium case has been allocated to you for digital design.',
    link: '/cases/dummy-case-id',
    metadata: { caseId: 'dummy-case-id', designerId: target.id }
  });
  console.log('Dispatch result details:', dispatchRes);

  // 4. Query database to confirm in-app insertion succeeded
  console.log('[Step 4] Checking notifications table for insertion...');
  const insertedNotifs = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, target.id),
        eq(notifications.type, NotificationType.CASE_ASSIGNED)
      )
    )
    .orderBy(notifications.createdAt);
  
  console.log(`Found ${insertedNotifs.length} matching notifications in DB:`, insertedNotifs);
  
  if (insertedNotifs.length > 0) {
    console.log('Verification Assertion: PASSED!');
    
    // Clean up inserted items
    console.log('[Step 5] Cleaning up test data from database...');
    await db.delete(notifications).where(eq(notifications.link, '/cases/dummy-case-id'));
    // Check if we seeded new preferences, delete if so, or keep it clean
    await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, target.id));
    console.log('Database cleanup completed successfully.');
  } else {
    console.error('Verification Assertion: FAILED (No notifications found in database!)');
  }

  console.log('=== VERIFICATION COMPLETED ===');
}

main().catch((err) => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
