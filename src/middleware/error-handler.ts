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
 * An error that Express or its body parser marked as the client's fault and
 * safe to report, such as malformed JSON (400) or a body that's too large
 * (413). These follow the `http-errors` convention: a 4xx `status` and
 * `expose: true`.
 */
interface ClientHttpError {
    status: number;
    expose: true;
    message: string;
    type?: string;
}

function isClientHttpError(err: unknown): err is ClientHttpError {
    if (typeof err !== 'object' || err === null) return false;
    const { status, expose } = err as { status?: unknown; expose?: unknown };
    return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

/**
 * Catch-all error handler.
 *
 * - A unique-constraint violation (Prisma P2002) becomes 409. It's mapped
 *   here, once, so every route that writes a unique field gets it.
 * - A client error from Express itself, such as malformed JSON, keeps its
 *   4xx status.
 * - Anything else logs the full error to the console and returns a generic
 *   500. No details or stack traces ever go in the response.
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

    if (isClientHttpError(err)) {
        // The JSON parser's own message quotes the body back; use a plain one.
        const message =
            err.type === 'entity.parse.failed' ? 'The request body is not valid JSON.' : err.message;
        res.status(err.status).json({ error: message });
        return;
    }

    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
}
