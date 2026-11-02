/**
 * @module src/middleware/error-handler
 * Global Express error-handling middleware.
 *
 * This must be the LAST middleware registered on the app so that
 * `next(error)` calls from route handlers are caught here.
 */

import { Request, Response, NextFunction } from 'express';
import { isPrismaError } from '../utils/prisma-errors.js';

/**
 * Catch-all error handler.
 *
 * - A unique-constraint violation (Prisma P2002) becomes 409. It's mapped
 *   here, once, so every route that writes a unique field gets it.
 * - Anything else logs the full stack trace to the console and returns a
 *   generic 500 response to the client.
 *
 * Individual routes should handle the other errors they expect (404, etc.)
 * before they reach this point.
 */
export function globalErrorHandler(
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    if (isPrismaError(err, 'P2002')) {
        // Prisma names the clashing fields in meta.target, e.g. ['name'].
        const target = (err as { meta?: { target?: unknown } }).meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : 'value';
        res.status(409).json({ error: `That ${fields} already exists.` });
        return;
    }

    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
}
