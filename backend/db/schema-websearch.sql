-- Web Search Configuration Table
CREATE TABLE IF NOT EXISTS web_search_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enabled BOOLEAN DEFAULT true,
    default_mode VARCHAR(20) DEFAULT 'fallback', -- 'always', 'fallback', 'manual'
    allowed_domains TEXT[], -- NULL means all allowed
    blocked_domains TEXT[] DEFAULT '{}',
    rate_limit_per_minute INTEGER DEFAULT 10,
    max_results_per_query INTEGER DEFAULT 5,
    crawl_depth VARCHAR(20) DEFAULT 'basic', -- 'basic', 'deep'
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Insert default configuration
INSERT INTO web_search_config (id, enabled, default_mode) 
VALUES ('00000000-0000-0000-0000-000000000001', true, 'fallback')
ON CONFLICT (id) DO NOTHING;

-- Web Search Cache Table (session-based caching)
CREATE TABLE IF NOT EXISTS web_search_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    query_hash VARCHAR(64) NOT NULL, -- MD5 of normalized query
    search_query TEXT NOT NULL,
    results JSONB NOT NULL, -- Cached web results with metadata
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_web_search_cache_workspace ON web_search_cache(workspace_id);
CREATE INDEX IF NOT EXISTS idx_web_search_cache_query_hash ON web_search_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_web_search_cache_expires ON web_search_cache(expires_at);

-- Web Search Analytics Table
CREATE TABLE IF NOT EXISTS web_search_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    query TEXT NOT NULL,
    web_sources_count INTEGER DEFAULT 0,
    firecrawl_api_calls INTEGER DEFAULT 0,
    response_time_ms INTEGER,
    used_web_results BOOLEAN DEFAULT false,
    cache_hit BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_search_analytics_created ON web_search_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_web_search_analytics_workspace ON web_search_analytics(workspace_id);
CREATE INDEX IF NOT EXISTS idx_web_search_analytics_user ON web_search_analytics(user_id);

-- Cleanup expired cache entries periodically
-- Note: You may want to set up a cron job to run this periodically
-- DELETE FROM web_search_cache WHERE expires_at < NOW();
