import pool from '../db/index.js';
import { firecrawlService, WebSource, WebSearchConfig } from './firecrawl.js';

// Types
interface DocumentSource {
    type: 'document';
    document_id: string;
    document_filename: string;
    chunk_index: number;
    content: string;
    relevance_score: number;
}

interface RankedSource {
    type: 'document' | 'web';
    final_score: number;
    [key: string]: any;
}

interface HybridQueryOptions {
    include_web_search?: boolean;
    web_search_depth?: 'basic' | 'deep';
    max_web_sources?: number;
    date_filter?: string;
    domain_filter?: string[];
}

interface HybridAnswer {
    answer: string;
    sources: {
        documents: DocumentSource[];
        web: WebSource[];
    };
    metadata: {
        used_web_search: boolean;
        web_sources_count: number;
        document_sources_count: number;
        cache_hit: boolean;
        search_time_ms: number;
    };
}

/**
 * Load web search configuration from database
 */
async function loadWebSearchConfig(): Promise<WebSearchConfig> {
    try {
        const result = await pool.query(
            'SELECT * FROM web_search_config WHERE id = $1',
            ['00000000-0000-0000-0000-000000000001']
        );

        if (result.rows.length === 0) {
            // Return default config if not found
            return {
                enabled: true,
                default_mode: 'fallback',
                allowed_domains: null,
                blocked_domains: [],
                rate_limit_per_minute: 10,
                max_results_per_query: 5,
                crawl_depth: 'basic'
            };
        }

        return result.rows[0];
    } catch (error) {
        console.error('Error loading web search config:', error);
        return {
            enabled: false,
            default_mode: 'manual',
            allowed_domains: null,
            blocked_domains: [],
            rate_limit_per_minute: 10,
            max_results_per_query: 5,
            crawl_depth: 'basic'
        };
    }
}

/**
 * Determine if web search should be triggered
 */
function shouldUseWebSearch(
    options: HybridQueryOptions,
    config: WebSearchConfig,
    docResults: DocumentSource[],
    question: string
): boolean {
    // Check if Firecrawl is available
    if (!firecrawlService.isEnabled()) {
        return false;
    }

    // Check if web search is globally disabled
    if (!config.enabled) {
        return false;
    }

    // User explicitly disabled web search
    if (options.include_web_search === false) {
        return false;
    }

    // Mode: manual - only if explicitly requested
    if (config.default_mode === 'manual' && options.include_web_search !== true) {
        return false;
    }

    // Mode: always - always use web search
    if (config.default_mode === 'always' || options.include_web_search === true) {
        return true;
    }

    // Mode: fallback - only if document results are insufficient
    if (config.default_mode === 'fallback') {
        // Check for time-sensitive queries
        if (/\b(latest|recent|current|today|2026|2025|new|now)\b/i.test(question)) {
            return true;
        }

        // Check if document results are high quality
        if (docResults.length > 0 && docResults[0].relevance_score > 0.7) {
            return false;
        }

        // Insufficient document coverage
        if (docResults.length < 3) {
            return true;
        }
    }

    return false;
}

/**
 * Check cache for existing web search results
 */
async function checkWebSearchCache(
    workspaceId: string,
    question: string
): Promise<WebSource[] | null> {
    try {
        const queryHash = firecrawlService.generateCacheKey(question);

        const result = await pool.query(
            `SELECT results FROM web_search_cache 
             WHERE workspace_id = $1 AND query_hash = $2 AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [workspaceId, queryHash]
        );

        if (result.rows.length > 0) {
            return result.rows[0].results;
        }

        return null;
    } catch (error) {
        console.error('Cache check error:', error);
        return null;
    }
}

/**
 * Cache web search results
 */
async function cacheWebResults(
    workspaceId: string,
    question: string,
    results: WebSource[]
): Promise<void> {
    try {
        const queryHash = firecrawlService.generateCacheKey(question);

        await pool.query(
            `INSERT INTO web_search_cache (workspace_id, query_hash, search_query, results)
             VALUES ($1, $2, $3, $4)`,
            [workspaceId, queryHash, question, JSON.stringify(results)]
        );
    } catch (error) {
        console.error('Cache save error:', error);
    }
}

/**
 * Perform web search and extract content
 */
async function performWebSearch(
    question: string,
    options: HybridQueryOptions,
    config: WebSearchConfig
): Promise<WebSource[]> {
    const searchQueries = firecrawlService.generateSearchQueries(question);
    const maxResults = options.max_web_sources || config.max_results_per_query;
    const waitTime = options.web_search_depth === 'deep' ? 5000 : 2000;

    try {
        // Execute search
        const searchResults = await firecrawlService.search(searchQueries[0], maxResults);

        // Filter by domains
        const urls = searchResults.map(r => r.url);
        const filteredUrls = firecrawlService.filterDomains(
            urls,
            config.allowed_domains,
            config.blocked_domains
        );

        // Apply user domain filter if provided
        let finalUrls = filteredUrls;
        if (options.domain_filter && options.domain_filter.length > 0) {
            finalUrls = filteredUrls.filter(url =>
                options.domain_filter!.some(domain => url.includes(domain))
            );
        }

        // Crawl and extract content from top results
        const crawlPromises = finalUrls.slice(0, 5).map(async (url, index) => {
            try {
                const result = await firecrawlService.scrape(url, waitTime);

                if (!result.success || !result.data) {
                    return null;
                }

                const content = result.data.markdown || result.data.html || '';
                const title = result.data.metadata?.title ||
                    result.data.metadata?.ogTitle ||
                    searchResults[index]?.title ||
                    'Untitled';

                // Calculate relevance
                const relevanceScore = firecrawlService.calculateRelevanceScore(content, question);

                // Get best excerpt
                const chunks = firecrawlService.chunkWebContent(content, 500);
                const bestChunk = chunks.reduce((best, chunk) => {
                    const score = firecrawlService.calculateRelevanceScore(chunk, question);
                    return score > firecrawlService.calculateRelevanceScore(best, question) ? chunk : best;
                }, chunks[0] || '');

                const webSource: WebSource = {
                    type: 'web',
                    url,
                    title,
                    domain: firecrawlService.extractDomain(url),
                    excerpt: bestChunk.substring(0, 300),
                    published_date: result.data.metadata?.publishedTime,
                    relevance_score: relevanceScore,
                    domain_authority: 50, // Default, could integrate with a DA API
                    favicon_url: `https://www.google.com/s2/favicons?domain=${firecrawlService.extractDomain(url)}&sz=32`
                };

                return webSource;
            } catch (error) {
                console.error(`Failed to crawl ${url}:`, error);
                return null;
            }
        });

        const crawledContent = await Promise.all(crawlPromises);

        // Filter out failed crawls and low-quality results
        const webSources = crawledContent
            .filter((source): source is WebSource => source !== null && source.relevance_score > 0.2);

        return webSources;
    } catch (error: any) {
        console.error('Web search error:', error);

        // Re-throw rate limit errors
        if (error.message.includes('rate limit') || error.message.includes('429')) {
            throw new Error('Web search rate limit reached. Please try again later.');
        }

        // For other errors, return empty array (graceful degradation)
        return [];
    }
}

/**
 * Rank hybrid sources (documents + web)
 */
function rankHybridSources(
    docSources: DocumentSource[],
    webSources: WebSource[],
    question: string
): RankedSource[] {
    const allSources: RankedSource[] = [];

    // Score document sources with slight preference
    docSources.forEach(doc => {
        allSources.push({
            ...doc,
            final_score: doc.relevance_score * 1.2
        });
    });

    // Score web sources with recency and authority bonuses
    webSources.forEach(web => {
        const recencyBonus = firecrawlService.calculateRecencyBonus(web.published_date);
        const authorityBonus = (web.domain_authority || 50) / 100;

        allSources.push({
            ...web,
            final_score: web.relevance_score * (1 + recencyBonus * 0.3) * (1 + authorityBonus * 0.2)
        });
    });

    // Sort by final score
    allSources.sort((a, b) => b.final_score - a.final_score);

    // Apply diversity: ensure both source types represented
    const result: RankedSource[] = [];
    let docsSeen = 0;
    let websSeen = 0;

    for (const source of allSources) {
        if (result.length >= 12) break;

        if (source.type === 'document' && docsSeen < 8) {
            result.push(source);
            docsSeen++;
        } else if (source.type === 'web' && websSeen < 6) {
            result.push(source);
            websSeen++;
        }
    }

    return result;
}

/**
 * Build hybrid context for LLM
 */
function buildHybridContext(sources: RankedSource[]): string {
    return sources.map(source => {
        if (source.type === 'document') {
            return `[DOCUMENT: ${source.document_filename}]\n${source.content}`;
        } else {
            const date = source.published_date ? ` (Published: ${new Date(source.published_date).toLocaleDateString()})` : '';
            return `[WEB: ${source.title}${date}]\nURL: ${source.url}\n${source.excerpt}`;
        }
    }).join('\n\n---\n\n');
}

/**
 * Generate answer with hybrid sources using Groq API
 */
async function generateHybridAnswer(
    question: string,
    context: string,
    sources: RankedSource[],
    workspaceName: string
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured');
    }

    const docSources = sources.filter(s => s.type === 'document');
    const webSources = sources.filter(s => s.type === 'web');

    const docList = docSources.length > 0
        ? docSources.map((s: any) => s.document_filename).join(', ')
        : 'None';
    const webList = webSources.length > 0
        ? webSources.map((s: any) => s.title).join(', ')
        : 'None';

    const prompt = `You are an intelligent research assistant with hybrid knowledge access.

**Workspace:** "${workspaceName}"

**Available Sources:**
- Workspace Documents (${docSources.length}): ${docList}
- Web Search Results (${webSources.length}): ${webList}

**Context:**
---
${context}
---

**Question:** ${question}

**Instructions:**
1. Synthesize information from ALL relevant sources (documents + web)
2. If sources conflict, present both perspectives with clear attribution
3. Clearly distinguish between workspace knowledge and web information
4. For time-sensitive info, mention publication dates
5. If information is not found in any source, state this explicitly
6. Cite sources using these formats:
   - Document: [Document Name]
   - Web: [Website Title]

**Answer Format:**
Provide a comprehensive answer followed by a "Sources" section listing all referenced sources.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: 'You are a multi-source research assistant. Synthesize information from workspace documents and web sources, handle conflicting information gracefully, and always cite sources clearly.'
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 1536,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('Groq API error:', response.status, err);
        if (response.status === 429) {
            throw new Error('Rate limit reached. Please try again in a moment.');
        }
        throw new Error('Failed to get answer from AI. Please try again.');
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || 'No answer generated.';
}

/**
 * Log search analytics
 */
async function logSearchAnalytics(data: {
    workspaceId: string;
    userId: string;
    question: string;
    webSourcesCount: number;
    firecrawlApiCalls: number;
    responseTimeMs: number;
    usedWebResults: boolean;
    cacheHit: boolean;
}): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO web_search_analytics 
             (workspace_id, user_id, query, web_sources_count, firecrawl_api_calls, response_time_ms, used_web_results, cache_hit)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                data.workspaceId,
                data.userId,
                data.question,
                data.webSourcesCount,
                data.firecrawlApiCalls,
                data.responseTimeMs,
                data.usedWebResults,
                data.cacheHit
            ]
        );
    } catch (error) {
        console.error('Analytics logging error:', error);
    }
}

/**
 * Main hybrid query function
 */
export async function hybridQuery(
    workspaceId: string,
    userId: string,
    workspaceName: string,
    question: string,
    docSources: DocumentSource[],
    options: HybridQueryOptions = {}
): Promise<HybridAnswer> {
    const startTime = Date.now();
    let webResults: WebSource[] = [];
    let cacheHit = false;
    let firecrawlApiCalls = 0;

    try {
        // Load configuration
        const config = await loadWebSearchConfig();

        // Determine if web search is needed
        const useWeb = shouldUseWebSearch(options, config, docSources, question);

        // Perform web search if needed
        if (useWeb) {
            // Check cache first
            const cachedResults = await checkWebSearchCache(workspaceId, question);
            if (cachedResults && cachedResults.length > 0) {
                webResults = cachedResults;
                cacheHit = true;
            } else {
                webResults = await performWebSearch(question, options, config);
                firecrawlApiCalls = webResults.length + 1; // 1 search + N scrapes

                // Cache results if successful
                if (webResults.length > 0) {
                    await cacheWebResults(workspaceId, question, webResults);
                }
            }
        }

        // Combine and rank sources
        const rankedSources = rankHybridSources(docSources, webResults, question);

        // Build context
        const context = buildHybridContext(rankedSources);

        // Generate answer
        const answer = await generateHybridAnswer(question, context, rankedSources, workspaceName);

        // Separate sources by type
        const documentSources = rankedSources.filter(s => s.type === 'document') as any as DocumentSource[];
        const webSources = rankedSources.filter(s => s.type === 'web') as any as WebSource[];

        const responseTime = Date.now() - startTime;

        // Log analytics
        await logSearchAnalytics({
            workspaceId,
            userId,
            question,
            webSourcesCount: webResults.length,
            firecrawlApiCalls,
            responseTimeMs: responseTime,
            usedWebResults: webResults.length > 0,
            cacheHit
        });

        return {
            answer,
            sources: {
                documents: documentSources,
                web: webSources
            },
            metadata: {
                used_web_search: useWeb,
                web_sources_count: webResults.length,
                document_sources_count: docSources.length,
                cache_hit: cacheHit,
                search_time_ms: responseTime
            }
        };
    } catch (error: any) {
        console.error('Hybrid query error:', error);

        // If web search fails, fall back to document-only
        if (webResults.length === 0 && docSources.length > 0) {
            const context = buildHybridContext(docSources as any as RankedSource[]);
            const answer = await generateHybridAnswer(question, context, docSources as any as RankedSource[], workspaceName);

            return {
                answer,
                sources: {
                    documents: docSources,
                    web: []
                },
                metadata: {
                    used_web_search: false,
                    web_sources_count: 0,
                    document_sources_count: docSources.length,
                    cache_hit: false,
                    search_time_ms: Date.now() - startTime
                }
            };
        }

        throw error;
    }
}
