/**
 * @module src/routes/health
 * Health check for monitoring and deploy scripts.
 *
 * "Healthy" means the API can reach its database, so the check runs a
 * trivial query rather than only answering from Express.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../../prisma/client.js';

const router = Router();

// ── GET /api/health ─────────────────────────────────────────────────────────
/**
 * Run `SELECT 1` through Prisma.
 *
 * The 503 body never includes the error: it could name the database host
 * or user. The details go to the server log instead.
 *
 * @returns 200 `{ status: 'ok' }`, or 503 `{ status: 'error' }` if the
 *          database is unreachable.
 */
router.get('/', async (_req: Request, res: Response) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error('[health] Database check failed:', error);
        res.status(503).json({ status: 'error' });
    }
});

export default router;
