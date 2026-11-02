/**
 * @module src/routes/ingredients
 * CRUD endpoints for the Ingredient resource.
 *
 * Ingredient names are normalised on write (lowercased and trimmed)
 * to ensure consistent matching. Duplicate detection uses the
 * normalised form. Deleting an ingredient that is referenced by
 * any RecipeIngredient is blocked (HTTP 409).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client.js';
import { isPrismaError } from '../utils/prisma-errors.js';
import { fuzzySearchByName } from '../utils/fuzzy-search.js';
import { parseOr400 } from '../utils/validation.js';
import { ingredientBodySchema } from '../schemas/ingredients.js';

const router = Router();

// ── GET /api/ingredients ────────────────────────────────────────────────────
/**
 * List all ingredients, optionally filtered by a fuzzy search term.
 *
 * Query params:
 *  - `search` (string, optional): fuzzy-match against ingredient names.
 *
 * @returns 200 with an array of Ingredient objects (may be empty).
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { search } = req.query;

        if (search) {
            const matches = await fuzzySearchByName('Ingredient', search as string);

            if (matches.length === 0) {
                res.status(200).json([]);
                return;
            }

            const ids = matches.map((m) => m.id);
            const ingredients = await prisma.ingredient.findMany({
                where: { id: { in: ids } },
            });

            // Preserve similarity ranking from the fuzzy search
            const sorted = ids.map((id) => ingredients.find((i) => i.id === id)).filter(Boolean);
            res.status(200).json(sorted);
            return;
        }

        const ingredients = await prisma.ingredient.findMany();
        res.status(200).json(ingredients);
    } catch (error) {
        next(error);
    }
});

// ── GET /api/ingredients/:id ────────────────────────────────────────────────
/**
 * Retrieve a single ingredient by UUID.
 *
 * @returns 200 with the Ingredient, or 404 if not found.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ingredient = await prisma.ingredient.findUnique({
            where: { id: req.params.id },
        });

        if (!ingredient) {
            res.status(404).json({ error: 'Ingredient not found.' });
            return;
        }

        res.status(200).json(ingredient);
    } catch (error) {
        next(error);
    }
});

// ── POST /api/ingredients ───────────────────────────────────────────────────
/**
 * Create a new ingredient. The name is normalised (lowercased, trimmed).
 *
 * Duplicate names are rejected with 409 by the unique constraint on `name`
 * (P2002, mapped in the error handler). Checking first with a query would
 * race: two requests could both find no duplicate, then both insert.
 *
 * @returns 201 with the created Ingredient, 400 on validation failure, or 409 for a duplicate.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(ingredientBodySchema, req.body, res);
        if (body === null) return;

        const ingredient = await prisma.ingredient.create({
            data: { name: body.name },
        });

        res.status(201).json(ingredient);
    } catch (error) {
        next(error);
    }
});

// ── PATCH /api/ingredients/:id ──────────────────────────────────────────────
/**
 * Update an ingredient's name. The new name is normalised.
 * Renaming to a name that's already taken returns 409 (P2002, as for POST).
 *
 * @returns 200 with the updated Ingredient, or 400/404/409 on failure.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(ingredientBodySchema, req.body, res);
        if (body === null) return;

        const ingredient = await prisma.ingredient.update({
            where: { id: req.params.id },
            data: { name: body.name },
        });

        res.status(200).json(ingredient);
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json({ error: 'Ingredient not found.' });
        } else {
            next(error);
        }
    }
});

// ── DELETE /api/ingredients/:id ─────────────────────────────────────────────
/**
 * Delete an ingredient by UUID.
 *
 * Fails with 409 if the ingredient is still referenced by any recipe
 * (Prisma `onDelete: Restrict` on RecipeIngredient).
 *
 * @returns 200 on success, 404 if not found, 409 if in use.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        await prisma.ingredient.delete({
            where: { id: req.params.id },
        });

        res.status(200).json({ message: 'Ingredient deleted successfully.' });
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json({ error: 'Ingredient not found.' });
        } else if (isPrismaError(error, 'P2003')) {
            res.status(409).json({ error: 'Cannot delete ingredient that is used in recipes.' });
        } else {
            next(error);
        }
    }
});

export default router;
