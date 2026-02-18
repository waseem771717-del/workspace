import { Router, Request, Response } from 'express';
import pool from '../db/index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ── POST /api/workspaces — create new workspace ─────────────
router.post('/', async (req: Request, res: Response) => {
    try {
        const { name, description } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ error: 'Workspace name is required' });
            return;
        }

        if (name.length > 255) {
            res.status(400).json({ error: 'Workspace name too long (max 255 characters)' });
            return;
        }

        const result = await pool.query(
            `INSERT INTO workspaces (user_id, name, description)
             VALUES ($1, $2, $3)
             RETURNING id, name, description, created_at, updated_at, last_activity`,
            [req.user!.id, name.trim(), description?.trim() || null]
        );

        res.status(201).json({
            workspace: {
                ...result.rows[0],
                document_count: 0
            }
        });
    } catch (err) {
        console.error('Create workspace error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/workspaces — list workspaces ───────────────────
router.get('/', async (req: Request, res: Response) => {
    try {
        const isAdmin = req.user!.role === 'admin';
        const showAll = req.query.all === 'true' && isAdmin;

        let query: string;
        let params: unknown[];

        if (showAll) {
            query = `
                SELECT 
                    w.id, w.name, w.description, w.created_at, w.updated_at, w.last_activity,
                    u.name as user_name, u.email as user_email,
                    COUNT(d.id) as document_count
                FROM workspaces w
                LEFT JOIN documents d ON w.id = d.workspace_id
                JOIN users u ON w.user_id = u.id
                GROUP BY w.id, u.name, u.email
                ORDER BY w.last_activity DESC
            `;
            params = [];
        } else {
            query = `
                SELECT 
                    w.id, w.name, w.description, w.created_at, w.updated_at, w.last_activity,
                    COUNT(d.id) as document_count
                FROM workspaces w
                LEFT JOIN documents d ON w.id = d.workspace_id
                WHERE w.user_id = $1
                GROUP BY w.id
                ORDER BY w.last_activity DESC
            `;
            params = [req.user!.id];
        }

        const result = await pool.query(query, params);

        // Convert document_count from string to number
        const workspaces = result.rows.map(row => ({
            ...row,
            document_count: parseInt(row.document_count)
        }));

        res.json({ workspaces });
    } catch (err) {
        console.error('List workspaces error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/workspaces/:id — get workspace details ─────────
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const isAdmin = req.user!.role === 'admin';

        // Get workspace
        let workspaceQuery: string;
        let workspaceParams: unknown[];

        if (isAdmin) {
            workspaceQuery = `
                SELECT w.*, u.name as user_name, u.email as user_email
                FROM workspaces w
                JOIN users u ON w.user_id = u.id
                WHERE w.id = $1
            `;
            workspaceParams = [id];
        } else {
            workspaceQuery = 'SELECT * FROM workspaces WHERE id = $1 AND user_id = $2';
            workspaceParams = [id, req.user!.id];
        }

        const workspaceResult = await pool.query(workspaceQuery, workspaceParams);
        if (workspaceResult.rows.length === 0) {
            res.status(404).json({ error: 'Workspace not found' });
            return;
        }

        const workspace = workspaceResult.rows[0];

        // Get documents in workspace
        const documentsResult = await pool.query(
            `SELECT id, filename, file_type, file_size, status, created_at
             FROM documents
             WHERE workspace_id = $1
             ORDER BY created_at DESC`,
            [id]
        );

        res.json({
            workspace: {
                ...workspace,
                document_count: documentsResult.rows.length,
                documents: documentsResult.rows
            }
        });
    } catch (err) {
        console.error('Get workspace error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── PATCH /api/workspaces/:id — update workspace ────────────
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;
        const isAdmin = req.user!.role === 'admin';

        // Verify ownership
        let checkQuery: string;
        let checkParams: unknown[];

        if (isAdmin) {
            checkQuery = 'SELECT * FROM workspaces WHERE id = $1';
            checkParams = [id];
        } else {
            checkQuery = 'SELECT * FROM workspaces WHERE id = $1 AND user_id = $2';
            checkParams = [id, req.user!.id];
        }

        const checkResult = await pool.query(checkQuery, checkParams);
        if (checkResult.rows.length === 0) {
            res.status(404).json({ error: 'Workspace not found' });
            return;
        }

        // Build update query dynamically
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramCount = 1;

        if (name !== undefined) {
            if (typeof name !== 'string' || name.trim().length === 0) {
                res.status(400).json({ error: 'Invalid workspace name' });
                return;
            }
            updates.push(`name = $${paramCount++}`);
            values.push(name.trim());
        }

        if (description !== undefined) {
            updates.push(`description = $${paramCount++}`);
            values.push(description?.trim() || null);
        }

        if (updates.length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }

        updates.push(`updated_at = NOW()`);
        values.push(id);

        const query = `
            UPDATE workspaces 
            SET ${updates.join(', ')}
            WHERE id = $${paramCount}
            RETURNING id, name, description, created_at, updated_at, last_activity
        `;

        const result = await pool.query(query, values);
        res.json({ workspace: result.rows[0] });
    } catch (err) {
        console.error('Update workspace error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── DELETE /api/workspaces/:id — delete workspace ───────────
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const isAdmin = req.user!.role === 'admin';

        // Verify ownership
        let checkQuery: string;
        let checkParams: unknown[];

        if (isAdmin) {
            checkQuery = 'SELECT * FROM workspaces WHERE id = $1';
            checkParams = [id];
        } else {
            checkQuery = 'SELECT * FROM workspaces WHERE id = $1 AND user_id = $2';
            checkParams = [id, req.user!.id];
        }

        const checkResult = await pool.query(checkQuery, checkParams);
        if (checkResult.rows.length === 0) {
            res.status(404).json({ error: 'Workspace not found' });
            return;
        }

        // Delete workspace (cascades to documents and chunks)
        await pool.query('DELETE FROM workspaces WHERE id = $1', [id]);

        res.json({ message: 'Workspace deleted' });
    } catch (err) {
        console.error('Delete workspace error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Helpers for Multi-Document Retrieval ───────────────────

interface ChunkWithScore {
    document_id: string;
    document_filename: string;
    chunk_index: number;
    content: string;
    score: number;
}

interface Source {
    document_id: string;
    document_name: string;
    chunk_index: number;
    excerpt: string;
    relevance_score: number;
}

/** Rank chunks across all documents with BM25-style scoring and document diversity */
function rankChunksAcrossDocuments(
    chunks: Array<{
        document_id: string;
        document_filename: string;
        chunk_index: number;
        content: string;
    }>,
    question: string,
    k: number = 12
): ChunkWithScore[] {
    // Tokenize question
    const stopWords = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
        'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
        'through', 'after', 'before', 'during', 'without', 'and', 'but', 'or',
        'not', 'no', 'so', 'if', 'then', 'than', 'that', 'this', 'it', 'its',
        'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
    ]);

    const keywords = question
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));

    if (keywords.length === 0) {
        return chunks.slice(0, k).map(c => ({ ...c, score: 0 }));
    }

    // Score each chunk with BM25-style scoring
    const scored = chunks.map((chunk) => {
        const lower = chunk.content.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
            const regex = new RegExp(kw, 'gi');
            const matches = lower.match(regex);
            score += matches ? matches.length : 0;
        }
        return { ...chunk, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Apply document diversity: ensure multiple documents represented
    const resultChunks: ChunkWithScore[] = [];
    const documentsSeen = new Set<string>();
    const remainingChunks: ChunkWithScore[] = [];

    // First pass: collect one chunk from each unique document
    for (const chunk of scored) {
        if (resultChunks.length >= k) break;
        if (!documentsSeen.has(chunk.document_id)) {
            resultChunks.push(chunk);
            documentsSeen.add(chunk.document_id);
        } else {
            remainingChunks.push(chunk);
        }
    }

    // Second pass: fill remaining slots with best scores
    for (const chunk of remainingChunks) {
        if (resultChunks.length >= k) break;
        resultChunks.push(chunk);
    }

    return resultChunks;
}

/** Call Groq API to answer question with multi-document context */
async function askGroqMultiDoc(
    chunks: ChunkWithScore[],
    question: string,
    workspaceName: string
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured');
    }

    // Build document list
    const uniqueDocs = [...new Set(chunks.map(c => c.document_filename))];
    const documentList = uniqueDocs.map((doc, i) => `${i + 1}. ${doc}`).join('\n');

    // Build context with source markers
    const context = chunks
        .map(
            (chunk) =>
                `[Source: ${chunk.document_filename}]\n${chunk.content}`
        )
        .join('\n\n---\n\n');

    const prompt = `You are answering a question using information from multiple documents in the workspace "${workspaceName}".

Available Documents:
${documentList}

Context from documents:
---
${context}
---

Question: ${question}

Instructions:
1. Synthesize information from ALL relevant sources
2. If sources conflict, present both perspectives clearly
3. Cite sources using [Document Name] format inline
4. If the answer cannot be found in any document, state this clearly
5. Be concise but comprehensive

Answer:`;

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
                    content: 'You are a multi-document research assistant. Synthesize information from multiple sources, handle conflicting information gracefully by presenting different perspectives, and always cite sources using [Document Name] format.',
                },
                { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 1024,
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

// ── POST /api/workspaces/:id/query — hybrid multi-document + web Q&A ─────
router.post('/:id/query', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const {
            question,
            include_web_search,
            web_search_depth,
            max_web_sources,
            date_filter,
            domain_filter
        } = req.body;
        const isAdmin = req.user!.role === 'admin';

        // Validate question
        if (!question || typeof question !== 'string' || question.trim().length === 0) {
            res.status(400).json({ error: 'Question is required' });
            return;
        }

        if (question.length > 500) {
            res.status(400).json({ error: 'Question too long (max 500 characters)' });
            return;
        }

        // Verify workspace access
        let workspaceQuery: string;
        let workspaceParams: unknown[];

        if (isAdmin) {
            workspaceQuery = 'SELECT * FROM workspaces WHERE id = $1';
            workspaceParams = [id];
        } else {
            workspaceQuery = 'SELECT * FROM workspaces WHERE id = $1 AND user_id = $2';
            workspaceParams = [id, req.user!.id];
        }

        const workspaceResult = await pool.query(workspaceQuery, workspaceParams);
        if (workspaceResult.rows.length === 0) {
            res.status(404).json({ error: 'Workspace not found' });
            return;
        }

        const workspace = workspaceResult.rows[0];

        // Get all ready documents in workspace
        const documentsResult = await pool.query(
            `SELECT id FROM documents 
             WHERE workspace_id = $1 AND status = 'ready'`,
            [id]
        );

        if (documentsResult.rows.length === 0) {
            res.status(400).json({ error: 'No ready documents in this workspace. Please upload and process documents first.' });
            return;
        }

        const documentIds = documentsResult.rows.map(row => row.id);

        // Get all chunks from all ready documents
        const chunksResult = await pool.query(
            `SELECT document_id, document_filename, chunk_index, content 
             FROM document_chunks 
             WHERE document_id = ANY($1)
             ORDER BY document_id, chunk_index`,
            [documentIds]
        );

        if (chunksResult.rows.length === 0) {
            res.status(400).json({ error: 'No content found in workspace documents' });
            return;
        }

        // Rank chunks across all documents (existing BM25 logic)
        const rankedChunks = rankChunksAcrossDocuments(chunksResult.rows, question.trim(), 12);

        // Convert to DocumentSource format for hybrid retrieval
        const docSources = rankedChunks.map(chunk => ({
            type: 'document' as const,
            document_id: chunk.document_id,
            document_filename: chunk.document_filename,
            chunk_index: chunk.chunk_index,
            content: chunk.content,
            relevance_score: chunk.score > 0 ? Math.min(chunk.score / 10, 1) : 0.5
        }));

        // Import hybrid retrieval
        const { hybridQuery } = await import('../services/hybridRetrieval.js');

        // Perform hybrid query (documents + web)
        const result = await hybridQuery(
            id,
            req.user!.id,
            workspace.name,
            question.trim(),
            docSources,
            {
                include_web_search,
                web_search_depth,
                max_web_sources,
                date_filter,
                domain_filter
            }
        );

        // Update workspace last_activity
        await pool.query('UPDATE workspaces SET last_activity = NOW() WHERE id = $1', [id]);

        // Format response
        res.json({
            answer: result.answer,
            sources: {
                documents: result.sources.documents.map(doc => ({
                    type: 'document',
                    document_id: doc.document_id,
                    document_name: doc.document_filename,
                    chunk_index: doc.chunk_index,
                    excerpt: doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
                    relevance_score: doc.relevance_score
                })),
                web: result.sources.web.map(web => ({
                    type: 'web',
                    url: web.url,
                    title: web.title,
                    domain: web.domain,
                    excerpt: web.excerpt,
                    published_date: web.published_date,
                    relevance_score: web.relevance_score,
                    domain_authority: web.domain_authority,
                    favicon_url: web.favicon_url
                }))
            },
            metadata: result.metadata
        });
    } catch (err: any) {
        console.error('Workspace query error:', err);
        res.status(500).json({ error: err.message || 'Failed to answer question' });
    }
});

export default router;

