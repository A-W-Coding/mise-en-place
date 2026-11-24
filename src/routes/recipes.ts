/**
 * @module src/routes/recipes
 * CRUD endpoints for the Recipe resource.
 *
 * A single recipe is returned with its nested recipeIngredients (including
 * the related Ingredient record), so the recipe page needs one request.
 * The list returns lighter summaries, without the lines or instructions,
 * so the client can load page after page quickly (Phase 3a).
 *
 * Deleting a recipe cascades to its RecipeIngredient rows but
 * leaves the underlying Ingredient records intact.
 *
 * Single-recipe responses carry an `ETag`, and PATCH and DELETE honour
 * `If-Match`, so an edit can't silently overwrite one made elsewhere (F3).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client.js';
import { isPrismaError } from '../utils/prisma-errors.js';
import { fuzzySearchByName } from '../utils/fuzzy-search.js';
import { parseOr400 } from '../utils/validation.js';
import { recipeEtag, ifMatchDates } from '../utils/etag.js';
import { RECIPE_INCLUDE } from '../utils/recipe-query.js';
import { createRecipeSchema, updateRecipeSchema, IngredientLine } from '../schemas/recipes.js';
import { listQuerySchema } from '../schemas/list-query.js';

const router = Router();

/**
 * The fields of a recipe in a list: everything but its ingredient lines and
 * instructions. From 3b, its tags and primary image join these.
 */
const RECIPE_SUMMARY_SELECT = {
    id: true,
    name: true,
    description: true,
    servings: true,
    prepTime: true,
    cookTime: true,
    createdAt: true,
    updatedAt: true,
} as const;

/**
 * Map validated ingredient lines into Prisma `create` data.
 * `orderIndex` comes from each line's position in the array.
 *
 * @param lines - Ingredient lines parsed by `ingredientLineSchema`.
 * @returns Array suitable for `recipeIngredients.create`.
 */
function toRecipeIngredientCreateData(lines: IngredientLine[]) {
    return lines.map((line, orderIndex) => ({
        ingredientId: line.ingredientId,
        orderIndex,
        quantity: line.quantity ?? null,
        quantityMax: line.quantityMax ?? null,
        unit: line.unit,
        note: line.note ?? null,
    }));
}

/** Sent when `If-Match` names a version of the recipe that's no longer current. */
const STALE_RECIPE = { error: 'The recipe has changed since it was loaded.' };

/**
 * The `where` clause for a write that honours `If-Match`. With an ETag list,
 * the row must also have one of the named `updatedAt` values, so checking the
 * version and writing happen in one statement and can't be raced.
 */
function recipeWhere(id: string, expected: Date[] | undefined) {
    return expected === undefined ? { id } : { id, updatedAt: { in: expected } };
}

/** A write found no row: 412 if the recipe exists (so its version didn't match), else 404. */
async function sendMissOrStale(res: Response, id: string, expected: Date[] | undefined): Promise<void> {
    const exists = expected !== undefined && (await prisma.recipe.count({ where: { id } })) > 0;
    if (exists) {
        res.status(412).json(STALE_RECIPE);
    } else {
        res.status(404).json({ error: 'Recipe not found.' });
    }
}

// ── GET /api/recipes ────────────────────────────────────────────────────────
/**
 * List recipes one page at a time, optionally filtered by a fuzzy search term.
 *
 * Query params (see `listQuerySchema`):
 *  - `search` (string, optional): fuzzy-match against recipe names.
 *  - `limit` (0–100, default 50) and `offset` (default 0): which page.
 *
 * Plain lists are ordered by name, then id. Search results are ordered by
 * rank, then name, then id. The `X-Total-Count` header gives the number of
 * recipes (or matches) across all pages (D6).
 *
 * Each recipe is a summary (`RECIPE_SUMMARY_SELECT`): the recipe page fetches
 * the lines and instructions with `GET /api/recipes/:id`.
 *
 * @returns 200 with an array of recipe summaries (may be empty), or 400 for a bad query.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = parseOr400(listQuerySchema, req.query, res);
        if (query === null) return;
        const { search, limit, offset } = query;

        if (search) {
            const { matches, total } = await fuzzySearchByName('Recipe', search, { limit, offset });

            const ids = matches.map((m) => m.id);
            const recipes = await prisma.recipe.findMany({
                where: { id: { in: ids } },
                select: RECIPE_SUMMARY_SELECT,
            });

            // Preserve similarity ranking from the fuzzy search
            const sorted = ids.map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
            res.status(200).set('X-Total-Count', String(total)).json(sorted);
            return;
        }

        const [recipes, total] = await Promise.all([
            prisma.recipe.findMany({
                select: RECIPE_SUMMARY_SELECT,
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                take: limit,
                skip: offset,
            }),
            prisma.recipe.count(),
        ]);
        res.status(200).set('X-Total-Count', String(total)).json(recipes);
    } catch (error) {
        next(error);
    }
});

// ── GET /api/recipes/:id ────────────────────────────────────────────────────
/**
 * Retrieve a single recipe by UUID, including its ingredients.
 *
 * @returns 200 with the Recipe and its `ETag`, or 404 if not found.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const recipe = await prisma.recipe.findUnique({
            where: { id: req.params.id },
            include: RECIPE_INCLUDE,
        });

        if (!recipe) {
            res.status(404).json({ error: 'Recipe not found.' });
            return;
        }

        res.status(200).set('ETag', recipeEtag(recipe.updatedAt)).json(recipe);
    } catch (error) {
        next(error);
    }
});

// ── POST /api/recipes ───────────────────────────────────────────────────────
/**
 * Create a new recipe, optionally with ingredient associations.
 *
 * Body (see `createRecipeSchema`):
 *  - `name` (string, required)
 *  - `id` (UUID, optional): chosen by the client (3c, D15). A device that
 *    created the recipe offline sends the same id every time it retries the
 *    upload, so a retry after a lost answer gets 409 instead of a second copy.
 *  - `description`, `servings`, `prepTime`, `cookTime`, `instructions` (optional)
 *  - `ingredients` (array of `{ ingredientId, quantity, quantityMax, unit, note }`, optional)
 *
 * @returns 201 with the created Recipe and its `ETag`, 400 on validation
 *          failure, or 409 if a recipe already has the given `id`.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(createRecipeSchema, req.body, res);
        if (body === null) return;

        // Spreading is safe here: the strict schema has already rejected
        // any field that isn't on its allowlist.
        const { ingredients = [], ...fields } = body;

        const recipe = await prisma.recipe.create({
            data: {
                ...fields,
                recipeIngredients: { create: toRecipeIngredientCreateData(ingredients) },
            },
            include: RECIPE_INCLUDE,
        });

        res.status(201).set('ETag', recipeEtag(recipe.updatedAt)).json(recipe);
    } catch (error) {
        if (isPrismaError(error, 'P2002')) {
            // A recipe's only unique field is its id, so this is a taken id.
            // The create and its lines are one statement, so nothing changed.
            res.status(409).json({ error: 'A recipe with that id already exists.' });
        } else if (isPrismaError(error, 'P2003')) {
            res.status(400).json({ error: 'One or more ingredient IDs are invalid.' });
        } else {
            next(error);
        }
    }
});

// ── PATCH /api/recipes/:id ──────────────────────────────────────────────────
/**
 * Partially update a recipe. Only supplied fields are changed.
 *
 * `ingredients`:
 *  - absent: the lines are left untouched.
 *  - an array: the lines are **replaced** entirely (delete-all then
 *    re-create, in one nested write that Prisma runs atomically).
 *  - an empty array: all lines are removed.
 *
 * `updatedAt` is set explicitly on every PATCH. Prisma's `@updatedAt`
 * can't be relied on when only the lines change, and sync needs the
 * timestamp to move whenever anything in the recipe does (F2).
 *
 * With `If-Match`, the update only happens if the recipe's current ETag is
 * one of those listed; otherwise it's a 412 and nothing changes (F3).
 *
 * @returns 200 with the updated Recipe and its new `ETag`, or 400/404/412 on failure.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const expected = ifMatchDates(req.get('If-Match'));
    try {
        const body = parseOr400(updateRecipeSchema, req.body, res);
        if (body === null) return;

        // Fields absent from the body are undefined, which Prisma leaves unchanged.
        const { ingredients, ...fields } = body;

        const recipe = await prisma.recipe.update({
            where: recipeWhere(req.params.id, expected),
            data: {
                ...fields,
                updatedAt: new Date(),
                // Replace all ingredient lines when a new array is provided
                ...(ingredients && {
                    recipeIngredients: {
                        deleteMany: {},
                        create: toRecipeIngredientCreateData(ingredients),
                    },
                }),
            },
            include: RECIPE_INCLUDE,
        });

        res.status(200).set('ETag', recipeEtag(recipe.updatedAt)).json(recipe);
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            await sendMissOrStale(res, req.params.id, expected);
        } else if (isPrismaError(error, 'P2003')) {
            res.status(400).json({ error: 'One or more ingredient IDs are invalid.' });
        } else {
            next(error);
        }
    }
});

// ── DELETE /api/recipes/:id ─────────────────────────────────────────────────
/**
 * Delete a recipe by UUID. Cascades to RecipeIngredient rows.
 * With `If-Match`, only the version it names is deleted (F3).
 *
 * @returns 200 on success, 404 if not found, or 412 if `If-Match` is out of date.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const expected = ifMatchDates(req.get('If-Match'));
    try {
        await prisma.recipe.delete({ where: recipeWhere(req.params.id, expected) });
        res.status(200).json({ message: 'Recipe deleted successfully.' });
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            await sendMissOrStale(res, req.params.id, expected);
        } else {
            next(error);
        }
    }
});

export default router;
