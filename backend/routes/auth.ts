import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/index.js';
import { signToken } from '../utils/jwt.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            res.status(400).json({ error: 'Email, password, and name are required' });
            return;
        }

        if (password.length < 6) {
            res.status(400).json({ error: 'Password must be at least 6 characters' });
            return;
        }

        // Check existing user
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing.rows.length > 0) {
            res.status(409).json({ error: 'Email already registered' });
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users (email, password, name, role, status)
       VALUES ($1, $2, $3, 'user', 'pending')
       RETURNING id, email, name, role, status, created_at`,
            [email.toLowerCase(), hashedPassword, name]
        );

        res.status(201).json({
            message: 'Account created. Awaiting admin approval.',
            user: result.rows[0],
        });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            res.status(400).json({ error: 'Email and password are required' });
            return;
        }

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        const user = result.rows[0];

        if (!user) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }

        const token = signToken({
            id: user.id,
            email: user.email,
            role: user.role,
            status: user.status,
        });

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                status: user.status,
            },
        });
    } catch (err: any) {
        console.error('Login error:', err);
        // Specialized error handling for connection issues
        if (err.code === 'ECONNREFUSED' || err.message.includes('connect')) {
            return res.status(503).json({ error: 'Database connection failed. Please try again later.' });
        }
        res.status(500).json({ error: `Internal server error: ${err.message}` });
    }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
    try {
        const result = await pool.query(
            'SELECT id, email, name, role, status, created_at, updated_at FROM users WHERE id = $1',
            [req.user!.id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
