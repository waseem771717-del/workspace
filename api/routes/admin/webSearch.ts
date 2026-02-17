import { Router, Request, Response } from 'express';
import pool from '../../db/index.js';
import { authenticate, requireAdmin } from '../../middleware/auth.js';

const router = Router();

// All routes require admin authentication
router.use(authenticate);
router.use(requireAdmin);

// ── GET /api/admin/web-search/config — Get web search configuration ─────
router.get('/config', async (req: Request, res: Response) => {
    try {
        const result = await pool.query(
            'SELECT * FROM web_search_config WHERE id = $1',
            ['00000000-0000-0000-0000-000000000001']
        );

        if (result.rows.length === 0) {
            // Return default config if not found
            res.json({
                config: {
                    enabled: true,
                    default_mode: 'fallback',
                    allowed_domains: null,
                    blocked_domains: [],
                    rate_limit_per_minute: 10,
                    max_results_per_query: 5,
                    crawl_depth: 'basic',
                    updated_at: new Date(),
                    updated_by: null
                }
            });
            return;
        }

        res.json({ config: result.rows[0] });
    } catch (err) {
        console.error('Get web search config error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/admin/web-search/config — Update web search configuration ─────
router.post('/config', async (req: Request, res: Response) => {
    try {
        const {
            enabled,
            default_mode,
            allowed_domains,
            blocked_domains,
            rate_limit_per_minute,
            max_results_per_query,
            crawl_depth
        } = req.body;

        // Validate default_mode
        if (default_mode && !['always', 'fallback', 'manual'].includes(default_mode)) {
            res.status(400).json({ error: 'Invalid default_mode. Must be: always, fallback, or manual' });
            return;
        }

        // Validate crawl_depth
        if (crawl_depth && !['basic', 'deep'].includes(crawl_depth)) {
            res.status(400).json({ error: 'Invalid crawl_depth. Must be: basic or deep' });
            return;
        }

        // Build update query dynamically
        const updates: string[] = [];
        const values: any[] = [];
        let paramCount = 1;

        if (typeof enabled === 'boolean') {
            updates.push(`enabled = $${paramCount++}`);
            values.push(enabled);
        }

        if (default_mode) {
            updates.push(`default_mode = $${paramCount++}`);
            values.push(default_mode);
        }

        if (allowed_domains !== undefined) {
            updates.push(`allowed_domains = $${paramCount++}`);
            values.push(allowed_domains);
        }

        if (blocked_domains !== undefined) {
            updates.push(`blocked_domains = $${paramCount++}`);
            values.push(blocked_domains);
        }

        if (rate_limit_per_minute) {
            updates.push(`rate_limit_per_minute = $${paramCount++}`);
            values.push(parseInt(rate_limit_per_minute));
        }

        if (max_results_per_query) {
            updates.push(`max_results_per_query = $${paramCount++}`);
            values.push(parseInt(max_results_per_query));
        }

        if (crawl_depth) {
            updates.push(`crawl_depth = $${paramCount++}`);
            values.push(crawl_depth);
        }

        updates.push(`updated_by = $${paramCount++}`);
        values.push(req.user!.id);

        updates.push(`updated_at = NOW()`);

        const result = await pool.query(
            `UPDATE web_search_config 
             SET ${updates.join(', ')}
             WHERE id = '00000000-0000-0000-0000-000000000001'
             RETURNING *`,
            values
        );

        res.json({ config: result.rows[0] });
    } catch (err) {
        console.error('Update web search config error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/admin/web-search/usage — Get usage analytics ─────
router.get('/usage', async (req: Request, res: Response) => {
    try {
        const { start_date, end_date, workspace_id } = req.query;

        let whereClause = 'WHERE 1=1';
        const params: any[] = [];
        let paramCount = 1;

        if (start_date) {
            whereClause += ` AND created_at >= $${paramCount++}`;
            params.push(start_date);
        }

        if (end_date) {
            whereClause += ` AND created_at <= $${paramCount++}`;
            params.push(end_date);
        }

        if (workspace_id) {
            whereClause += ` AND workspace_id = $${paramCount++}`;
            params.push(workspace_id);
        }

        // Get aggregate statistics
        const statsResult = await pool.query(
            `SELECT 
                COUNT(*) as total_searches,
                COUNT(*) FILTER (WHERE used_web_results = true) as web_searches,
                COALESCE(AVG(web_sources_count) FILTER (WHERE used_web_results = true), 0) as avg_web_sources,
                COALESCE(SUM(firecrawl_api_calls), 0) as total_api_calls,
                COALESCE(AVG(response_time_ms), 0) as avg_response_time_ms,
                COUNT(*) FILTER (WHERE cache_hit = true) as cache_hits
             FROM web_search_analytics
             ${whereClause}`,
            params
        );

        // Get top queries
        const topQueriesResult = await pool.query(
            `SELECT query, COUNT(*) as count
             FROM web_search_analytics
             ${whereClause}
             GROUP BY query
             ORDER BY count DESC
             LIMIT 10`,
            params
        );

        const stats = statsResult.rows[0];
        const cacheHitRate = parseInt(stats.total_searches) > 0
            ? (parseInt(stats.cache_hits) / parseInt(stats.total_searches) * 100).toFixed(1)
            : 0;

        res.json({
            total_searches: parseInt(stats.total_searches),
            web_searches: parseInt(stats.web_searches),
            avg_web_sources: parseFloat(stats.avg_web_sources).toFixed(1),
            total_api_calls: parseInt(stats.total_api_calls),
            avg_response_time_ms: Math.round(stats.avg_response_time_ms),
            cache_hit_rate: cacheHitRate,
            top_queries: topQueriesResult.rows.map((row: any) => ({
                query: row.query,
                count: parseInt(row.count)
            }))
        });
    } catch (err) {
        console.error('Get web search usage error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── DELETE /api/admin/web-search/cache — Clear web search cache ─────
router.delete('/cache', async (req: Request, res: Response) => {
    try {
        const { workspace_id } = req.query;

        if (workspace_id) {
            await pool.query('DELETE FROM web_search_cache WHERE workspace_id = $1', [workspace_id]);
            res.json({ message: 'Workspace cache cleared successfully' });
        } else {
            await pool.query('DELETE FROM web_search_cache');
            res.json({ message: 'All cache cleared successfully' });
        }
    } catch (err) {
        console.error('Clear cache error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
