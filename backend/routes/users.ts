import { Router, Request, Response } from 'express';
import pool from '../db/index.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// All routes require admin
router.use(authenticate, requireRole('admin'));

// GET /api/users — all users
router.get('/', async (_req: Request, res: Response) => {
    try {
        const result = await pool.query(
            'SELECT id, email, name, role, status, created_at, updated_at FROM users ORDER BY created_at DESC'
        );
        res.json({ users: result.rows });
    } catch (err) {
        console.error('List users error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/pending — pending users only
router.get('/pending', async (_req: Request, res: Response) => {
    try {
        const result = await pool.query(
            `SELECT id, email, name, role, status, created_at, updated_at
       FROM users WHERE status = 'pending' ORDER BY created_at DESC`
        );
        res.json({ users: result.rows });
    } catch (err) {
        console.error('Pending users error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/stats — dashboard statistics
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const total = await pool.query('SELECT COUNT(*) FROM users');
        const pending = await pool.query("SELECT COUNT(*) FROM users WHERE status = 'pending'");
        const approved = await pool.query("SELECT COUNT(*) FROM users WHERE status = 'approved'");
        const rejected = await pool.query("SELECT COUNT(*) FROM users WHERE status = 'rejected'");

        res.json({
            stats: {
                total: parseInt(total.rows[0].count),
                pending: parseInt(pending.rows[0].count),
                approved: parseInt(approved.rows[0].count),
                rejected: parseInt(rejected.rows[0].count),
            },
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/users/:id/approve
router.put('/:id/approve', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE users SET status = 'approved', updated_at = NOW()
       WHERE id = $1 RETURNING id, email, name, role, status`,
            [id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({ message: 'User approved', user: result.rows[0] });
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/users/:id/reject
router.put('/:id/reject', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE users SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 RETURNING id, email, name, role, status`,
            [id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({ message: 'User rejected', user: result.rows[0] });
    } catch (err) {
        console.error('Reject error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/users/:id
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Prevent self-deletion
        if (id === req.user!.id) {
            res.status(400).json({ error: 'Cannot delete your own account' });
            return;
        }

        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({ message: 'User deleted' });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
