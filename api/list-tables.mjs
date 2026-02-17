import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const result = await pool.query(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname='public' 
    ORDER BY tablename
`);

console.log('📋 Existing tables in database:');
result.rows.forEach(row => console.log('  -', row.tablename));

await pool.end();
