/**
 * @module src/routes/tags
 * CRUD endpoints for the Tag resource (3b; technical spec §3.2).
 *
 * Tags are a shared list, like ingredients: names are normalised on write
 * (trimmed, lowercase) and unique, so a taken name is a 409. A tag has a
 * colour (`#rrggbb`) or none. Every tag this route returns carries its
 * `recipeCount`, how many recipes use it, which the list's tag filter orders
 * by and Options › Tags shows. Deleting a tag removes it from every recipe
 * that has it: unlike an ingredient, a recipe depends on nothing in a tag.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client.js';
import { isPrismaError } from '../utils/prisma-errors.js';
import { fuzzySearchByName } from '../utils/fuzzy-search.js';
import { parseOr400 } from '../utils/validation.js';
import { createTagSchema, updateTagSchema } from '../schemas/tags.js';
import { listQuerySchema } from '../schemas/list-query.js';

const router = Router();

/** Reads a tag with how many recipes use it. */
const WITH_COUNT = { _count: { select: { recipes: true } } } as const;

type CountedTag = { _count: { recipes: number } } & Record<string, unknown>;

/** A tag as the API returns it: its own fields and `recipeCount`. */
function withRecipeCount({ _count, ...tag }: CountedTag) {
    return { ...tag, recipeCount: _count.recipes };
}

const NOT_FOUND = { error: 'Tag not found.' };

// ── GET /api/tags ───────────────────────────────────────────────────────────
/**
 * List tags one page at a time, optionally filtered by a fuzzy search term,
 * exactly as `GET /api/ingredients` does: plain lists by name, then id;
 * searches by rank; the total in `X-Total-Count` (D6).
 *
 * @returns 200 with an array of tags, each with its `recipeCount`, or 400 for a bad query.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = parseOr400(listQuerySchema, req.query, res);
        if (query === null) return;
        const { search, limit, offset } = query;

        if (search) {
            const { matches, total } = await fuzzySearchByName('Tag', search, { limit, offset });
            const ids = matches.map((m) => m.id);
            const tags = await prisma.tag.findMany({ where: { id: { in: ids } }, include: WITH_COUNT });

            // Preserve similarity ranking from the fuzzy search
            const sorted = ids.flatMap((id) => tags.filter((tag) => tag.id === id)).map(withRecipeCount);
            res.status(200).set('X-Total-Count', String(total)).json(sorted);
            return;
        }

        const [tags, total] = await Promise.all([
            prisma.tag.findMany({
                include: WITH_COUNT,
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                take: limit,
                skip: offset,
            }),
            prisma.tag.count(),
        ]);
        res.status(200).set('X-Total-Count', String(total)).json(tags.map(withRecipeCount));
    } catch (error) {
        next(error);
    }
});

// ── GET /api/tags/:id ───────────────────────────────────────────────────────
/**
 * Retrieve a single tag by UUID.
 *
 * @returns 200 with the tag and its `recipeCount`, or 404 if not found.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tag = await prisma.tag.findUnique({ where: { id: req.params.id }, include: WITH_COUNT });
        if (!tag) {
            res.status(404).json(NOT_FOUND);
            return;
        }
        res.status(200).json(withRecipeCount(tag));
    } catch (error) {
        next(error);
    }
});

// ── POST /api/tags ──────────────────────────────────────────────────────────
/**
 * Create a tag: `{ name, color? }`. A taken name is a 409 from the unique
 * constraint (P2002, mapped in the error handler), as for ingredients.
 *
 * @returns 201 with the tag (`recipeCount` 0), 400 on validation failure, or 409 for a taken name.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(createTagSchema, req.body, res);
        if (body === null) return;

        const tag = await prisma.tag.create({ data: { name: body.name, color: body.color ?? null }, include: WITH_COUNT });
        res.status(201).json(withRecipeCount(tag));
    } catch (error) {
        next(error);
    }
});

// ── PATCH /api/tags/:id ─────────────────────────────────────────────────────
/**
 * Rename or recolour a tag: `{ name?, color? }`, changing only what's sent.
 * A null colour removes it. Renaming to a taken name is a 409 (P2002).
 *
 * @returns 200 with the tag and its `recipeCount`, or 400/404/409 on failure.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(updateTagSchema, req.body, res);
        if (body === null) return;

        const tag = await prisma.tag.update({
            where: { id: req.params.id },
            data: { name: body.name, color: body.color },
            include: WITH_COUNT,
        });
        res.status(200).json(withRecipeCount(tag));
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json(NOT_FOUND);
        } else {
            next(error);
        }
    }
});

// ── DELETE /api/tags/:id ────────────────────────────────────────────────────
/**
 * Delete a tag, taking it off every recipe that has it (Cascade on RecipeTag).
 *
 * @returns 200 on success, or 404 if not found.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        await prisma.tag.delete({ where: { id: req.params.id } });
        res.status(200).json({ message: 'Tag deleted successfully.' });
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json(NOT_FOUND);
        } else {
            next(error);
        }
    }
});

export default router;
