require('dotenv').config();
const postgres = require('postgres');

async function testConnection() {
  try {
    console.log('Testing database connection...');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
    
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL is missing from .env file');
      process.exit(1);
    }

    const sql = postgres(process.env.DATABASE_URL);
    
    // Test basic connection
    const result = await sql`SELECT NOW()`;
    console.log('✅ Database connection successful:', result[0]);
    
    // Check if profile table exists
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'profiles'
    `;
    
    if (tables.length > 0) {
      console.log('✅ Profile table exists');
    } else {
      console.log('❌ Profile table does not exist');
    }
    
    await sql.end();
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

testConnection();
