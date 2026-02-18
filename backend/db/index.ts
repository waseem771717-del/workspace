import { Pool, neonConfig } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import ws from 'ws';

dotenv.config();

// WebSocket is needed for the Neon serverless driver in Node.js
// In serverless environments (Vercel), this is handled automatically
if (!process.env.VERCEL && typeof WebSocket === 'undefined') {
    try {
        const ws = await import('ws');
        neonConfig.webSocketConstructor = ws.default;
    } catch (e) {
        console.warn('Could not import ws, but it might not be needed if WebSocket is globally available.');
    }
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export default pool;
