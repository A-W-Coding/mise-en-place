/**
 * @module src/routes/recipes
 * CRUD endpoints for the Recipe resource.
 *
 * Recipes are always returned with their nested recipeIngredients
 * (including the related Ingredient record) so clients get a
 * complete picture in a single request.
 *
 * Deleting a recipe cascades to its RecipeIngredient rows but
 * leaves the underlying Ingredient records intact.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client.js';
import { isPrismaError } from '../utils/prisma-errors.js';
import { fuzzySearchByName } from '../utils/fuzzy-search.js';
import { parseOr400 } from '../utils/validation.js';
import { createRecipeSchema, updateRecipeSchema, IngredientLine } from '../schemas/recipes.js';

const router = Router();

/**
 * Standard Prisma `include` clause used by every recipe query.
 * Nests recipeIngredients → ingredient so the client receives
 * fully-resolved ingredient data.
 */
const RECIPE_INCLUDE = {
    recipeIngredients: {
        include: { ingredient: true },
    },
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

// ── GET /api/recipes ────────────────────────────────────────────────────────
/**
 * List all recipes, optionally filtered by a fuzzy search term.
 *
 * Query params:
 *  - `search` (string, optional): fuzzy-match against recipe names.
 *
 * @returns 200 with an array of Recipe objects (may be empty).
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { search } = req.query;

        if (search) {
            const matches = await fuzzySearchByName('Recipe', search as string);

            if (matches.length === 0) {
                res.status(200).json([]);
                return;
            }

            const ids = matches.map((m) => m.id);
            const recipes = await prisma.recipe.findMany({
                where: { id: { in: ids } },
                include: RECIPE_INCLUDE,
            });

            // Preserve similarity ranking from the fuzzy search
            const sorted = ids.map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
            res.status(200).json(sorted);
            return;
        }

        const recipes = await prisma.recipe.findMany({ include: RECIPE_INCLUDE });
        res.status(200).json(recipes);
    } catch (error) {
        next(error);
    }
});

// ── GET /api/recipes/:id ────────────────────────────────────────────────────
/**
 * Retrieve a single recipe by UUID, including its ingredients.
 *
 * @returns 200 with the Recipe, or 404 if not found.
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

        res.status(200).json(recipe);
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
 *  - `description`, `servings`, `prepTime`, `cookTime`, `instructions` (optional)
 *  - `ingredients` (array of `{ ingredientId, quantity, quantityMax, unit, note }`, optional)
 *
 * @returns 201 with the created Recipe, or 400 on validation failure.
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

        res.status(201).json(recipe);
    } catch (error) {
        if (isPrismaError(error, 'P2003')) {
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
 * If an `ingredients` array is provided, the existing associations
 * are **replaced** entirely (delete-all then re-create).
 *
 * @returns 200 with the updated Recipe, or 400/404 on failure.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(updateRecipeSchema, req.body, res);
        if (body === null) return;

        // Fields absent from the body are undefined, which Prisma leaves unchanged.
        const { ingredients, ...fields } = body;

        const recipe = await prisma.recipe.update({
            where: { id: req.params.id },
            data: {
                ...fields,
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

        res.status(200).json(recipe);
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json({ error: 'Recipe not found.' });
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
 *
 * @returns 200 on success, or 404 if not found.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        await prisma.recipe.delete({ where: { id: req.params.id } });
        res.status(200).json({ message: 'Recipe deleted successfully.' });
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            res.status(404).json({ error: 'Recipe not found.' });
        } else {
            next(error);
        }
    }
});

export default router;
