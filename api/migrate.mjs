import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runMigrations() {
    try {
        console.log('🔄 Running database migrations...\n');

        // 0. Create workspaces table first (if it doesn't exist)
        console.log('0️⃣ Creating workspaces table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS workspaces (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                last_activity TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_workspaces_activity ON workspaces(last_activity DESC);
        `);
        console.log('   ✓ Workspaces table ready\n');

        // 1. Add workspace_id to documents (only if documents table exists)
        console.log('1️⃣ Updating documents table...');
        try {
            await pool.query(`
                ALTER TABLE documents 
                ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
            `);
            console.log('   ✓ Added workspace_id column');

            await pool.query(`
                ALTER TABLE document_chunks 
                ADD COLUMN IF NOT EXISTS document_filename VARCHAR(255);
            `);
            console.log('   ✓ Added document_filename column\n');
        } catch (err) {
            console.log('   ⚠️  Documents table not found, skipping...\n');
        }

        // 2. Create web search config table
        console.log('2️⃣ Creating web search config table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS web_search_config (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                enabled BOOLEAN DEFAULT true,
                default_mode VARCHAR(20) DEFAULT 'fallback',
                allowed_domains TEXT[],
                blocked_domains TEXT[] DEFAULT '{}',
                rate_limit_per_minute INTEGER DEFAULT 10,
                max_results_per_query INTEGER DEFAULT 5,
                crawl_depth VARCHAR(20) DEFAULT 'basic',
                updated_at TIMESTAMP DEFAULT NOW(),
                updated_by UUID
            );
        `);
        await pool.query(`
            INSERT INTO web_search_config (id) 
            VALUES ('00000000-0000-0000-0000-000000000001')
            ON CONFLICT (id) DO NOTHING;
        `);
        console.log('   ✓ Web search config created\n');

        // 3. Create web search cache table
        console.log('3️⃣ Creating web search cache table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS web_search_cache (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
                query_hash VARCHAR(64) NOT NULL,
                search_query TEXT NOT NULL,
                results JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '1 hour'
            );
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_web_search_cache_workspace ON web_search_cache(workspace_id);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_web_search_cache_query_hash ON web_search_cache(query_hash);
        `);
        console.log('   ✓ Web search cache created\n');

        // 4. Create web search analytics table
        console.log('4️⃣ Creating web search analytics table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS web_search_analytics (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id UUID,
                query TEXT NOT NULL,
                web_sources_count INTEGER DEFAULT 0,
                firecrawl_api_calls INTEGER DEFAULT 0,
                response_time_ms INTEGER,
                used_web_results BOOLEAN DEFAULT false,
                cache_hit BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_web_search_analytics_created ON web_search_analytics(created_at);
        `);
        console.log('   ✓ Web search analytics created\n');

        console.log('🎉 All migrations completed successfully!');
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error('Full error:', error);
        await pool.end();
        process.exit(1);
    }
}

runMigrations();
