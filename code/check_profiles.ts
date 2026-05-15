import 'dotenv/config';
import { db } from './src/db';
import { profiles } from './src/db/schema/profile';

async function checkProfiles() {
  try {
    const allProfiles = await db.select().from(profiles);
    console.log('--- Current Profiles ---');
    allProfiles.forEach(p => {
      console.log(`ID: ${p.id}, Email: ${p.email}, Role: ${p.role}`);
    });
    console.log('------------------------');
  } catch (error) {
    console.error('Error checking profiles:', error);
  }
  process.exit(0);
}

checkProfiles();
