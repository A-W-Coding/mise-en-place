/**
 * @module src/routes/sync
 * `GET /api/sync`: everything a device needs offline, in one response
 * (Phase 3c, D8; technical spec §3.3).
 *
 * The snapshot is deterministic: every array is sorted, and the body holds no
 * time of its own, so the same data always gives the same bytes. Its ETag is
 * a hash of those bytes. A device sends back the ETag of the copy it has in
 * `If-None-Match`, and if nothing has changed it gets a 304 with no body.
 *
 * A snapshot can't miss a change the way timestamp-based syncing can (F2):
 * a deleted recipe simply isn't in the next one.
 */

import { createHash } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client.js';
import { RECIPE_INCLUDE } from '../utils/recipe-query.js';

const router = Router();

/** Recipes and ingredients by name, then id, so equal names still sort the same way every time. */
const BY_NAME_THEN_ID = [{ name: 'asc' }, { id: 'asc' }] as const;

/**
 * The strong ETag for a snapshot: the SHA-256 of its body, base64url-encoded
 * (43 characters) and quoted.
 */
export function snapshotEtag(body: string): string {
    return `"${createHash('sha256').update(body).digest('base64url')}"`;
}

/**
 * Whether an `If-None-Match` header already names `etag`, or is `*`.
 *
 * Unlike `If-Match`, `If-None-Match` uses the weak comparison (RFC 9110
 * §13.1.2), so `W/"x"` matches `"x"`. A proxy that compresses a response may
 * weaken its ETag, and the copy is still the same.
 */
export function noneMatch(header: string | undefined, etag: string): boolean {
    if (header === undefined) return false;
    return header
        .split(',')
        .map((tag) => tag.trim())
        .some((tag) => tag === '*' || tag.replace(/^W\//, '') === etag);
}

// ── GET /api/sync ───────────────────────────────────────────────────────────
/**
 * The whole snapshot: `{ recipes, ingredients }`. Each recipe is as
 * `GET /api/recipes/:id` returns it, and `ingredients` holds every
 * ingredient. 3b adds `tags` and `equipment`.
 *
 * `Cache-Control: no-cache` makes any cache check with the API before reusing
 * a stored copy, which costs only a 304 when nothing has changed.
 *
 * @returns 200 with the snapshot and its `ETag`, or 304 with no body when
 *          `If-None-Match` names the current one.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // One transaction at REPEATABLE READ, so every query sees the database
        // at the same moment. Without it, a recipe saved between the queries
        // could use an ingredient that the ingredient list doesn't have yet.
        const [recipes, ingredients] = await prisma.$transaction(
            [
                prisma.recipe.findMany({ include: RECIPE_INCLUDE, orderBy: [...BY_NAME_THEN_ID] }),
                prisma.ingredient.findMany({ orderBy: [...BY_NAME_THEN_ID] }),
            ],
            { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        );

        const body = JSON.stringify({ recipes, ingredients });
        const etag = snapshotEtag(body);
        res.set({ ETag: etag, 'Cache-Control': 'no-cache' });

        if (noneMatch(req.get('If-None-Match'), etag)) {
            res.status(304).end();
            return;
        }
        res.status(200).type('application/json').send(body);
    } catch (error) {
        next(error);
    }
});

export default router;
