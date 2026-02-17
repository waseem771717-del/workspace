import crypto from 'crypto';

// Types
export interface WebSearchConfig {
    enabled: boolean;
    default_mode: 'always' | 'fallback' | 'manual';
    allowed_domains: string[] | null;
    blocked_domains: string[];
    rate_limit_per_minute: number;
    max_results_per_query: number;
    crawl_depth: 'basic' | 'deep';
}

export interface WebSource {
    type: 'web';
    url: string;
    title: string;
    domain: string;
    excerpt: string;
    published_date?: string;
    relevance_score: number;
    domain_authority?: number;
    favicon_url?: string;
}

export interface FirecrawlSearchResult {
    url: string;
    title: string;
    description: string;
}

export interface FirecrawlScrapeResult {
    success: boolean;
    data?: {
        markdown?: string;
        html?: string;
        metadata?: {
            title?: string;
            description?: string;
            ogTitle?: string;
            publishedTime?: string;
        };
    };
}

/**
 * Firecrawl Service - Handles web search and content extraction
 */
class FirecrawlService {
    private apiKey: string;
    private baseUrl = 'https://api.firecrawl.dev/v1';

    constructor() {
        this.apiKey = process.env.FIRECRAWL_API_KEY || '';
        if (!this.apiKey) {
            console.warn('FIRECRAWL_API_KEY not configured. Web search will be disabled.');
        }
    }

    /**
     * Check if Firecrawl is enabled
     */
    isEnabled(): boolean {
        return !!this.apiKey;
    }

    /**
     * Search the web using Firecrawl
     */
    async search(query: string, limit: number = 5): Promise<FirecrawlSearchResult[]> {
        if (!this.apiKey) {
            throw new Error('Firecrawl API key not configured');
        }

        try {
            const response = await fetch(`${this.baseUrl}/search`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query,
                    limit,
                    lang: 'en',
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Firecrawl search failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            return data.data || [];
        } catch (error: any) {
            console.error('Firecrawl search error:', error);
            throw new Error(`Web search failed: ${error.message}`);
        }
    }

    /**
     * Scrape and extract content from a URL
     */
    async scrape(url: string, waitFor: number = 2000): Promise<FirecrawlScrapeResult> {
        if (!this.apiKey) {
            throw new Error('Firecrawl API key not configured');
        }

        try {
            const response = await fetch(`${this.baseUrl}/scrape`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url,
                    formats: ['markdown', 'html'],
                    onlyMainContent: true,
                    waitFor,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Firecrawl scrape failed: ${response.status} - ${errorText}`);
            }

            return await response.json();
        } catch (error: any) {
            console.error(`Firecrawl scrape error for ${url}:`, error);
            return { success: false };
        }
    }

    /**
     * Generate search queries from user question
     */
    generateSearchQueries(question: string): string[] {
        // Remove question words and generate focused search terms
        const cleaned = question
            .replace(/^(what|who|when|where|why|how|which|is|are|does|do|can|could|would|should)\s+/i, '')
            .replace(/\?$/, '')
            .trim();

        return [cleaned]; // For now, just use the cleaned query
    }

    /**
     * Calculate relevance score for web content
     */
    calculateRelevanceScore(content: string, question: string): number {
        const questionWords = question.toLowerCase().split(/\s+/)
            .filter(w => w.length > 3);

        const contentLower = content.toLowerCase();
        let matches = 0;

        for (const word of questionWords) {
            const regex = new RegExp(word, 'gi');
            const wordMatches = contentLower.match(regex);
            if (wordMatches) {
                matches += wordMatches.length;
            }
        }

        // Normalize to 0-1 range
        return Math.min(matches / (questionWords.length * 2), 1);
    }

    /**
     * Extract domain from URL
     */
    extractDomain(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
        } catch {
            return url;
        }
    }

    /**
     * Calculate recency bonus based on published date
     */
    calculateRecencyBonus(publishedDate?: string): number {
        if (!publishedDate) return 0;

        try {
            const ageInDays = (Date.now() - new Date(publishedDate).getTime()) / (1000 * 60 * 60 * 24);

            if (ageInDays < 1) return 1.0; // Published today
            if (ageInDays < 7) return 0.8; // This week
            if (ageInDays < 30) return 0.5; // This month
            if (ageInDays < 365) return 0.2; // This year
            return 0; // Older
        } catch {
            return 0;
        }
    }

    /**
     * Filter URLs by allowed/blocked domains
     */
    filterDomains(
        urls: string[],
        allowedDomains: string[] | null,
        blockedDomains: string[]
    ): string[] {
        return urls.filter(url => {
            const domain = this.extractDomain(url);

            // Check blocked domains
            if (blockedDomains.some(blocked => domain.includes(blocked))) {
                return false;
            }

            // Check allowed domains (if specified)
            if (allowedDomains && allowedDomains.length > 0) {
                return allowedDomains.some(allowed => domain.includes(allowed));
            }

            return true;
        });
    }

    /**
     * Generate cache key for a query
     */
    generateCacheKey(query: string): string {
        const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
        return crypto.createHash('md5').update(normalized).digest('hex');
    }

    /**
     * Chunk web content into manageable pieces
     */
    chunkWebContent(content: string, maxChunkSize: number = 1000): string[] {
        const chunks: string[] = [];
        const paragraphs = content.split('\n\n');
        let currentChunk = '';

        for (const para of paragraphs) {
            if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
                currentChunk = para;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + para;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }

        return chunks.filter(chunk => chunk.length > 50); // Filter out very short chunks
    }
}

// Export singleton instance
export const firecrawlService = new FirecrawlService();
