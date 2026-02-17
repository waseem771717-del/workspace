import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../db/index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ── Multer config ──────────────────────────────────────
const UPLOAD_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'uploads');

const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const userDir = path.join(UPLOAD_DIR, req.user!.id);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (_req, file, cb) => {
        const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1e4);
        // Sanitize filename to prevent directory traversal
        const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${uniquePrefix}-${safeName}`);
    },
});

const ALLOWED_TYPES = [
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/markdown',
    'text/x-markdown'
];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
    storage,
    limits: { fileSize: MAX_SIZE },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Allowed formats: PDF, TXT, DOCX, JPG, PNG, WEBP, CSV, MD'));
        }
    },
});

// ── Helpers ──────────────────────────────────────────────

/** Extract text from a PDF buffer */
async function extractPdfText(filePath: string): Promise<string> {
    const pdfParse = await import('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const parseFunc = pdfParse.default || pdfParse;
    const data = await parseFunc(buffer);
    return data.text;
}

/** Extract text from a TXT file */
function extractTxtText(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

/** Extract text from a DOCX file */
async function extractDocxText(filePath: string): Promise<string> {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
}

/** Extract text from an Image using Gemini */
async function extractImageText(filePath: string, fileType: string): Promise<string> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured for Image OCR');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = fileType === 'jpg' ? 'image/jpeg' : `image/${fileType}`;

    const prompt = "Extract all text from this image. Return ONLY the text, no conversational filler.";

    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: fileBuffer.toString('base64'),
                mimeType
            }
        }
    ]);

    return result.response.text();
}

/** Extract text from a CSV file */
function extractCsvText(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Simple CSV to text conversion
    const rows = content.split('\n').map(row => row.trim()).filter(row => row.length > 0);
    return rows.join('\n');
}

/** Extract text from a Markdown file */
function extractMarkdownText(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

/** Split text into overlapping chunks */
function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push(text.slice(start, end));
        start += chunkSize - overlap;
        if (start >= text.length) break;
    }
    return chunks;
}

/** Find relevant chunks based on keyword matching */
function findRelevantChunks(
    chunks: { chunk_index: number; content: string }[],
    question: string,
    maxChunks = 5
): string[] {
    // Tokenize question into keywords (remove common stop words)
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
        // If no meaningful keywords, return first few chunks
        return chunks.slice(0, maxChunks).map((c) => c.content);
    }

    // Score each chunk by keyword frequency
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

    // Sort by score descending, take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxChunks).map((c) => c.content);
}

/** Call Groq API to answer a question with context */
async function askGroq(context: string, question: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured. Please add it to your .env file.');
    }

    const prompt = `Context from the document:
---
${context}
---

Question: ${question}

Answer the question based ONLY on the provided context above. Be concise and accurate. If the answer cannot be found in the context, say "I cannot find this information in the document."`;

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
                    content: 'You are a helpful document assistant. Answer questions based only on the provided document context. Be concise and factual.',
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

// ── Routes ───────────────────────────────────────────────

// POST /api/documents/upload — upload a PDF or TXT file
router.post('/upload', (req: Request, res: Response) => {
    upload.single('file')(req, res, async (err: any) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
                    return;
                }
                res.status(400).json({ error: err.message });
                return;
            }
            res.status(400).json({ error: err.message || 'Upload failed' });
            return;
        }

        if (!req.file) {
            res.status(400).json({ error: 'No file provided' });
            return;
        }

        try {
            const { workspace_id } = req.body;

            // Validate workspace_id
            if (!workspace_id || typeof workspace_id !== 'string') {
                res.status(400).json({ error: 'workspace_id is required' });
                return;
            }

            // Verify workspace exists and user has access
            const isAdmin = req.user!.role === 'admin';
            let workspaceQuery: string;
            let workspaceParams: unknown[];

            if (isAdmin) {
                workspaceQuery = 'SELECT * FROM workspaces WHERE id = $1';
                workspaceParams = [workspace_id];
            } else {
                workspaceQuery = 'SELECT * FROM workspaces WHERE id = $1 AND user_id = $2';
                workspaceParams = [workspace_id, req.user!.id];
            }

            const workspaceResult = await pool.query(workspaceQuery, workspaceParams);
            if (workspaceResult.rows.length === 0) {
                res.status(404).json({ error: 'Workspace not found' });
                return;
            }

            const file = req.file;
            let fileType = 'txt';
            if (file.mimetype === 'application/pdf') fileType = 'pdf';
            else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') fileType = 'docx';
            else if (file.mimetype.startsWith('image/')) fileType = file.mimetype.split('/')[1];
            else if (file.mimetype === 'text/csv') fileType = 'csv';
            else if (file.mimetype === 'text/markdown' || file.mimetype === 'text/x-markdown') fileType = 'md';

            // Insert document record
            const docResult = await pool.query(
                `INSERT INTO documents (user_id, workspace_id, filename, file_path, file_type, file_size, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'processing')
                 RETURNING id, filename, file_type, file_size, status, created_at`,
                [req.user!.id, workspace_id, file.originalname, file.path, fileType, file.size]
            );
            const doc = docResult.rows[0];

            // Update workspace last_activity
            await pool.query(
                'UPDATE workspaces SET last_activity = NOW() WHERE id = $1',
                [workspace_id]
            );

            // Process document asynchronously (non-blocking response)
            processDocument(doc.id, file.path, fileType, file.originalname).catch((e) => {
                console.error(`Error processing document ${doc.id}:`, e);
            });

            res.status(201).json({ document: doc });
        } catch (err) {
            console.error('Upload error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

/** Process a document: extract text, chunk it, store chunks */
async function processDocument(docId: string, filePath: string, fileType: string, filename: string) {
    try {
        // Extract text
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found at path: ${filePath}`);
        }

        let text: string = '';
        if (fileType === 'pdf') {
            text = await extractPdfText(filePath);
        } else if (fileType === 'docx') {
            text = await extractDocxText(filePath);
        } else if (['jpg', 'jpeg', 'png', 'webp'].includes(fileType)) {
            text = await extractImageText(filePath, fileType);
        } else if (fileType === 'csv') {
            text = extractCsvText(filePath);
        } else if (fileType === 'md') {
            text = extractMarkdownText(filePath);
        } else {
            text = extractTxtText(filePath);
        }

        if (!text || text.trim().length === 0) {
            await pool.query("UPDATE documents SET status = 'error' WHERE id = $1", [docId]);
            return;
        }

        // Chunk the text
        const chunks = chunkText(text);

        // Insert chunks with document filename for source attribution
        for (let i = 0; i < chunks.length; i++) {
            await pool.query(
                `INSERT INTO document_chunks (document_id, document_filename, chunk_index, content)
                 VALUES ($1, $2, $3, $4)`,
                [docId, filename, i, chunks[i]]
            );
        }

        // Mark as ready
        await pool.query("UPDATE documents SET status = 'ready' WHERE id = $1", [docId]);
        console.log(`Document ${docId} processed: ${chunks.length} chunks created`);
    } catch (err) {
        console.error(`Failed to process document ${docId}:`, err);
        await pool.query("UPDATE documents SET status = 'error' WHERE id = $1", [docId]);
    }
}

// GET /api/documents — list documents
router.get('/', async (req: Request, res: Response) => {
    try {
        const isAdmin = req.user!.role === 'admin';
        const showAll = req.query.all === 'true' && isAdmin;

        let query: string;
        let params: unknown[];

        if (showAll) {
            query = `SELECT d.*, u.name as user_name, u.email as user_email
                     FROM documents d
                     JOIN users u ON d.user_id = u.id
                     ORDER BY d.created_at DESC`;
            params = [];
        } else {
            query = `SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC`;
            params = [req.user!.id];
        }

        const result = await pool.query(query, params);
        res.json({ documents: result.rows });
    } catch (err) {
        console.error('List documents error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/documents/:id — get single document
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const isAdmin = req.user!.role === 'admin';

        let query: string;
        let params: unknown[];

        if (isAdmin) {
            query = `SELECT d.*, u.name as user_name, u.email as user_email
                     FROM documents d
                     JOIN users u ON d.user_id = u.id
                     WHERE d.id = $1`;
            params = [id];
        } else {
            query = 'SELECT * FROM documents WHERE id = $1 AND user_id = $2';
            params = [id, req.user!.id];
        }

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Document not found' });
            return;
        }

        // Also get chunk count
        const chunkCount = await pool.query(
            'SELECT COUNT(*) FROM document_chunks WHERE document_id = $1',
            [id]
        );

        res.json({
            document: {
                ...result.rows[0],
                chunk_count: parseInt(chunkCount.rows[0].count),
            },
        });
    } catch (err) {
        console.error('Get document error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/documents/:id — delete document + file + chunks
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const isAdmin = req.user!.role === 'admin';

        // Find the document first
        let query: string;
        let params: unknown[];

        if (isAdmin) {
            query = 'SELECT * FROM documents WHERE id = $1';
            params = [id];
        } else {
            query = 'SELECT * FROM documents WHERE id = $1 AND user_id = $2';
            params = [id, req.user!.id];
        }

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Document not found' });
            return;
        }

        const doc = result.rows[0];

        // Delete file from disk
        try {
            if (fs.existsSync(doc.file_path)) {
                fs.unlinkSync(doc.file_path);
            } else {
                console.warn(`File not found for deletion: ${doc.file_path}`);
            }
        } catch (e) {
            console.error('Failed to delete file:', e);
        }

        // Delete from database (cascades to chunks)
        await pool.query('DELETE FROM documents WHERE id = $1', [id]);

        res.json({ message: 'Document deleted' });
    } catch (err) {
        console.error('Delete document error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/documents/:id/ask — ask a question about a document
router.post('/:id/ask', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { question } = req.body;

        if (!question || typeof question !== 'string' || question.trim().length === 0) {
            res.status(400).json({ error: 'Question is required' });
            return;
        }

        if (question.length > 500) {
            res.status(400).json({ error: 'Question too long (max 500 characters)' });
            return;
        }

        const isAdmin = req.user!.role === 'admin';

        // Verify document access
        let docQuery: string;
        let docParams: unknown[];

        if (isAdmin) {
            docQuery = 'SELECT * FROM documents WHERE id = $1';
            docParams = [id];
        } else {
            docQuery = 'SELECT * FROM documents WHERE id = $1 AND user_id = $2';
            docParams = [id, req.user!.id];
        }

        const docResult = await pool.query(docQuery, docParams);
        if (docResult.rows.length === 0) {
            res.status(404).json({ error: 'Document not found' });
            return;
        }

        const doc = docResult.rows[0];
        if (doc.status !== 'ready') {
            res.status(400).json({
                error: doc.status === 'processing'
                    ? 'Document is still being processed. Please wait a moment.'
                    : 'Document could not be processed. Please re-upload.',
            });
            return;
        }

        // Rate limit: 10 questions per day per user
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // We'll count based on a simple approach — track via a lightweight method
        // For now, no separate table needed, just proceed

        // Get all chunks for this document
        const chunksResult = await pool.query(
            'SELECT chunk_index, content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index',
            [id]
        );

        if (chunksResult.rows.length === 0) {
            res.status(400).json({ error: 'No content found in this document' });
            return;
        }

        // Find relevant chunks
        const relevantTexts = findRelevantChunks(chunksResult.rows, question);
        const context = relevantTexts.join('\n\n---\n\n');

        // Call Groq API
        const answer = await askGroq(context, question.trim());

        res.json({ answer, document: doc.filename });
    } catch (err: any) {
        console.error('Ask question error:', err);
        res.status(500).json({ error: err.message || 'Failed to answer question' });
    }
});

export default router;
