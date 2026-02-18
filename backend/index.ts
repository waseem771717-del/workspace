import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import aiRoutes from './routes/ai.js';
import documentRoutes from './routes/documents.js';
import workspaceRoutes from './routes/workspaces.js';
import adminWebSearchRoutes from './routes/admin/webSearch.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/admin/web-search', adminWebSearchRoutes);

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test DB Connection
app.get('/api/test-db', async (_req, res) => {
    try {
        const { default: pool } = await import('./db/index.js');
        const result = await pool.query('SELECT NOW()');
        res.json({ status: 'connected', time: result.rows[0].now });
    } catch (err: any) {
        console.error('Test DB Error:', err);
        res.status(500).json({ error: `DB Connection failed: ${err.message}`, details: err });
    }
});

// Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// For local development
const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 API server running on http://localhost:${PORT}`);
    });
}

export default app;
