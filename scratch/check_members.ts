import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { profiles } from '../src/db/schema/profile'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const db = drizzle(sql)

async function check() {
  try {
    const results = await db.select().from(profiles);
    console.log("Total profiles:", results.length);
    results.forEach(p => {
      console.log(`ID: ${p.id}, FullName: ${p.fullName}, Role: ${p.role}, Status: ${p.status}, Email: ${p.email}`);
    });
  } catch (err) {
    console.error("Error:", err);
  }
  await sql.end();
  process.exit(0);
}

check();
