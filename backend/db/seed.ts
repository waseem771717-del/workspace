import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pool from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seed() {
    console.log('🌱 Seeding database...');

    // Run schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('✅ Users schema created');

    // Run summaries schema
    const summariesSchemaPath = path.join(__dirname, 'schema-summaries.sql');
    const summariesSchema = fs.readFileSync(summariesSchemaPath, 'utf-8');
    await pool.query(summariesSchema);
    console.log('✅ Summaries schema created');

    // Check if admin already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [
        'admin@dashboard.com',
    ]);

    if (existing.rows.length === 0) {
        const hashedPassword = await bcrypt.hash('Admin@123', 12);
        await pool.query(
            `INSERT INTO users (email, password, name, role, status)
       VALUES ($1, $2, $3, 'admin', 'approved')`,
            ['admin@dashboard.com', hashedPassword, 'Admin']
        );
        console.log('✅ Admin user created (admin@dashboard.com / Admin@123)');
    } else {
        console.log('ℹ️  Admin user already exists');
    }

    console.log('🎉 Seed complete!');
    process.exit(0);
}

seed().catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
});
