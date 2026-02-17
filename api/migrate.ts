import pool from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
    console.log('🔄 Running database migrations...\n');

    try {
        // Migration 1: Workspaces schema
        console.log('1️⃣ Creating workspaces table...');
        const workspacesSchema = fs.readFileSync(
            path.join(__dirname, 'db/schema-workspaces.sql'),
            'utf-8'
        );
        await pool.query(workspacesSchema);
        console.log('✅ Workspaces table created\n');

        // Migration 2: Add workspace support to documents
        console.log('2️⃣ Adding workspace support to documents...');
        const workspacesMigration = fs.readFileSync(
            path.join(__dirname, 'db/migration-add-workspaces.sql'),
            'utf-8'
        );
        await pool.query(workspacesMigration);
        console.log('✅ Documents updated with workspace support\n');

        // Migration 3: Web search schema
        console.log('3️⃣ Creating web search tables...');
        const webSearchSchema = fs.readFileSync(
            path.join(__dirname, 'db/schema-websearch.sql'),
            'utf-8'
        );
        await pool.query(webSearchSchema);
        console.log('✅ Web search tables created\n');

        console.log('🎉 All migrations completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration error:', err);
        throw err;
    }
}

runMigrations().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
