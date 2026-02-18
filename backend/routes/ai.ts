import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { YoutubeTranscript } from 'youtube-transcript';
import pool from '../db/index.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import dotenv from 'dotenv';
import path from 'path';
import { exec } from 'child_process';

dotenv.config();

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ── Helpers ──────────────────────────────────────────────

function extractVideoId(url: string): string | null {
    const patterns = [
        /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

async function fetchVideoMeta(videoId: string) {
    try {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await res.json();
        return {
            title: data.title || 'Untitled Video',
            thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        };
    } catch {
        return {
            title: 'Untitled Video',
            thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        };
    }
}

const SUMMARY_PROMPT = `You are an expert study notes creator. Given the following YouTube video transcript, create comprehensive, well-structured study notes in Markdown.

**Format your response EXACTLY like this:**

## 📝 Key Takeaways
- (5-7 concise bullet points of the most important ideas)

## 📖 Detailed Summary
(3-4 well-written paragraphs covering the main content)

## 📚 Important Terms & Concepts
| Term | Definition |
|------|-----------|
| (key term) | (brief definition) |

## 🔖 Notable Quotes / Moments
- (2-3 important quotes or timestamped moments)

## ❓ Study Questions
1. (Question to test understanding)
2. (Question to test understanding)
3. (Question to test understanding)

---

Here is the transcript:

`;

// ── Routes ───────────────────────────────────────────────

// All routes require authentication
router.use(authenticate);

// POST /api/ai/summarize — generate summary from YouTube URL
router.post('/summarize', async (req: Request, res: Response) => {
    try {
        const { youtubeUrl } = req.body;
        if (!youtubeUrl) {
            res.status(400).json({ error: 'YouTube URL is required' });
            return;
        }

        const videoId = extractVideoId(youtubeUrl);
        if (!videoId) {
            res.status(400).json({ error: 'Invalid YouTube URL. Please provide a valid youtube.com or youtu.be link.' });
            return;
        }

        // Rate limit: 10 per day per user
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const usageResult = await pool.query(
            'SELECT COUNT(*) FROM video_summaries WHERE user_id = $1 AND created_at >= $2',
            [req.user!.id, today.toISOString()]
        );
        const dailyCount = parseInt(usageResult.rows[0].count);
        if (dailyCount >= 10) {
            res.status(429).json({
                error: 'Daily limit reached (10 summaries/day). Try again tomorrow.',
                remaining: 0,
            });
            return;
        }

        // Fetch video metadata
        const meta = await fetchVideoMeta(videoId);

        // Fetch transcript
        let transcriptText: string;
        try {
            const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
            transcriptText = transcriptItems.map((item: { text: string }) => item.text).join(' ');
        } catch {
            res.status(422).json({
                error: 'No captions/transcript available for this video. The video may not have subtitles enabled.',
            });
            return;
        }

        // Chunk long transcripts (Gemini Flash handles ~1M tokens, but keep it reasonable)
        if (transcriptText.length > 30000) {
            transcriptText = transcriptText.substring(0, 30000) + '\n\n[Transcript truncated for processing]';
        }

        // Call local Python summarizer
        const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
        const scriptPath = path.join(process.cwd(), 'api', 'utils', 'summarizer.py');

        console.log(`Executing local summarizer: ${pythonCommand} "${scriptPath}" "${youtubeUrl}"`);

        const execPromise = () => new Promise<string>((resolve, reject) => {
            // Increase maxBuffer for long transcripts/summaries (10MB)
            exec(`${pythonCommand} "${scriptPath}" "${youtubeUrl}"`, { maxBuffer: 10 * 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    console.error('Python execution error:', error);
                    console.error('stderr:', stderr);
                    reject(new Error(stderr || 'Failed to execute local summarizer'));
                } else {
                    resolve(stdout);
                }
            });
        });

        let pythonOutput: string;
        try {
            pythonOutput = await execPromise();
        } catch (err: any) {
            res.status(500).json({ error: err.message || 'Local AI processing failed' });
            return;
        }

        let resultData: any;
        try {
            resultData = JSON.parse(pythonOutput);
        } catch (err) {
            console.error('Failed to parse Python output:', pythonOutput);
            res.status(500).json({ error: 'Failed to process AI output' });
            return;
        }

        if (resultData.error) {
            res.status(resultData.error.includes('captions') ? 422 : 400).json({ error: resultData.error });
            return;
        }

        // Format the summary text for the database/frontend
        const summaryText = `### Title: ${meta.title}

### Short Summary:
${resultData.short_summary}

### Detailed Summary:
${resultData.detailed_summary}

### Key Takeaways:
${resultData.key_takeaways.map((t: string) => `- ${t}`).join('\n')}
`;

        // Save to database
        const insertResult = await pool.query(
            `INSERT INTO video_summaries (user_id, youtube_url, video_id, video_title, thumbnail_url, summary_text)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, youtube_url, video_id, video_title, thumbnail_url, summary_text, created_at`,
            [req.user!.id, youtubeUrl, videoId, meta.title, meta.thumbnail, summaryText]
        );

        res.status(201).json({
            summary: insertResult.rows[0],
            remaining: 10 - dailyCount - 1,
        });
    } catch (err: any) {
        console.error('Summarize error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate summary' });
    }
});

// GET /api/ai/summaries — list summaries (own for user, all for admin)
router.get('/summaries', async (req: Request, res: Response) => {
    try {
        const isAdmin = req.user!.role === 'admin';
        const showAll = req.query.all === 'true' && isAdmin;

        let query: string;
        let params: unknown[];

        if (showAll) {
            query = `SELECT vs.*, u.name as user_name, u.email as user_email
               FROM video_summaries vs
               JOIN users u ON vs.user_id = u.id
               ORDER BY vs.created_at DESC`;
            params = [];
        } else {
            query = `SELECT * FROM video_summaries WHERE user_id = $1 ORDER BY created_at DESC`;
            params = [req.user!.id];
        }

        const result = await pool.query(query, params);
        res.json({ summaries: result.rows });
    } catch (err) {
        console.error('List summaries error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/ai/summaries/:id — single summary detail
router.get('/summaries/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const isAdmin = req.user!.role === 'admin';

        let query: string;
        let params: unknown[];

        if (isAdmin) {
            query = `SELECT vs.*, u.name as user_name, u.email as user_email
               FROM video_summaries vs
               JOIN users u ON vs.user_id = u.id
               WHERE vs.id = $1`;
            params = [id];
        } else {
            query = 'SELECT * FROM video_summaries WHERE id = $1 AND user_id = $2';
            params = [id, req.user!.id];
        }

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Summary not found' });
            return;
        }

        res.json({ summary: result.rows[0] });
    } catch (err) {
        console.error('Get summary error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/ai/summaries/:id — delete summary
router.delete('/summaries/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const isAdmin = req.user!.role === 'admin';

        let query: string;
        let params: unknown[];

        if (isAdmin) {
            query = 'DELETE FROM video_summaries WHERE id = $1 RETURNING id';
            params = [id];
        } else {
            query = 'DELETE FROM video_summaries WHERE id = $1 AND user_id = $2 RETURNING id';
            params = [id, req.user!.id];
        }

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Summary not found' });
            return;
        }

        res.json({ message: 'Summary deleted' });
    } catch (err) {
        console.error('Delete summary error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/ai/stats — admin only usage stats
router.get('/stats', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
        const total = await pool.query('SELECT COUNT(*) FROM video_summaries');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayCount = await pool.query(
            'SELECT COUNT(*) FROM video_summaries WHERE created_at >= $1',
            [today.toISOString()]
        );
        const topUsers = await pool.query(
            `SELECT u.name, u.email, COUNT(vs.id) as summary_count
       FROM video_summaries vs
       JOIN users u ON vs.user_id = u.id
       GROUP BY u.id, u.name, u.email
       ORDER BY summary_count DESC
       LIMIT 5`
        );

        res.json({
            stats: {
                totalSummaries: parseInt(total.rows[0].count),
                todaySummaries: parseInt(todayCount.rows[0].count),
                topUsers: topUsers.rows,
            },
        });
    } catch (err) {
        console.error('AI stats error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
