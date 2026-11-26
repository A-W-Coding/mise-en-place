/**
 * @module src/routes/recipes
 * CRUD endpoints for the Recipe resource.
 *
 * A single recipe is returned with its nested recipeIngredients (including
 * the related Ingredient record) and, from 3b, its method's sections and
 * steps, so the recipe page needs one request. The list returns lighter
 * summaries, without the lines or the method, so the client can load page
 * after page quickly (Phase 3a).
 *
 * A recipe is written as a whole (spec §2.3, note 1): its sections, steps,
 * lines, tags and equipment lines arrive in its POST or PATCH body and
 * replace what's there, in one transaction, which also sets its `updatedAt`.
 *
 * Deleting a recipe cascades to everything that belongs to it, but leaves
 * the shared Ingredient, Tag and Equipment records intact.
 *
 * The list can be filtered by a tag (`?tag=<id>`, 3b), with or without a
 * search.
 *
 * Single-recipe responses carry an `ETag`, and PATCH and DELETE honour
 * `If-Match`, so an edit can't silently overwrite one made elsewhere (F3).
 */

import { randomUUID } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client.js';
import { isPrismaError } from '../utils/prisma-errors.js';
import { fuzzySearchByName, recipesTagged } from '../utils/fuzzy-search.js';
import { parseOr400 } from '../utils/validation.js';
import { recipeEtag, ifMatchDates } from '../utils/etag.js';
import { RECIPE_INCLUDE, RECIPE_SUMMARY_SELECT } from '../utils/recipe-query.js';
import {
    createRecipeSchema,
    updateRecipeSchema,
    type EquipmentLine,
    type IngredientLine,
    type Section,
} from '../schemas/recipes.js';
import { recipeListQuerySchema } from '../schemas/list-query.js';

const router = Router();

/**
 * Thrown inside a write's transaction when the body names a tag or an item
 * that doesn't exist, so nothing is written; answered with 400 and its message.
 */
class UnknownReference extends Error {}

const BAD_INGREDIENTS = { error: 'One or more ingredient IDs are invalid.' };

/**
 * Write a recipe's sections and their steps, giving each section its id
 * here, so its lines can name it in the same transaction.
 * `orderIndex` comes from each one's position in its array.
 *
 * @returns The new sections' ids, in order: a line's `sectionIndex` picks one.
 */
async function writeSections(tx: Prisma.TransactionClient, recipeId: string, sections: Section[]): Promise<string[]> {
    const ids = sections.map(() => randomUUID());
    await tx.recipeSection.createMany({
        data: sections.map((section, orderIndex) => ({ id: ids[orderIndex], recipeId, name: section.name, orderIndex })),
    });
    await tx.instruction.createMany({
        data: sections.flatMap((section, index) =>
            section.steps.map((step, orderIndex) => ({
                sectionId: ids[index],
                orderIndex,
                text: step.text,
                timerSeconds: step.timerSeconds ?? null,
            })),
        ),
    });
    return ids;
}

/**
 * Write a recipe's ingredient lines. `orderIndex` comes from each line's
 * position in the array, and `sectionIndex` becomes the id of the section
 * at that position (the schema has checked it points inside `sections`).
 */
async function writeLines(
    tx: Prisma.TransactionClient,
    recipeId: string,
    lines: IngredientLine[],
    sectionIds: string[],
): Promise<void> {
    await tx.recipeIngredient.createMany({
        data: lines.map((line, orderIndex) => ({
            recipeId,
            ingredientId: line.ingredientId,
            orderIndex,
            quantity: line.quantity ?? null,
            quantityMax: line.quantityMax ?? null,
            unit: line.unit,
            note: line.note ?? null,
            sectionId: line.sectionIndex === null || line.sectionIndex === undefined ? null : sectionIds[line.sectionIndex],
        })),
    });
}

/**
 * Write a recipe's tags, in order (3b). Every id must be a tag that exists:
 * checked first, so the answer can say which list was wrong, rather than
 * leaving it to the foreign key, which can't tell a tag from an ingredient.
 */
async function writeTags(tx: Prisma.TransactionClient, recipeId: string, tagIds: string[]): Promise<void> {
    if ((await tx.tag.count({ where: { id: { in: tagIds } } })) !== tagIds.length) {
        throw new UnknownReference('One or more tag IDs are invalid.');
    }
    await tx.recipeTag.createMany({ data: tagIds.map((tagId, orderIndex) => ({ recipeId, tagId, orderIndex })) });
}

/** Write a recipe's equipment lines, in order (3b), each naming an item that exists. */
async function writeEquipment(tx: Prisma.TransactionClient, recipeId: string, lines: EquipmentLine[]): Promise<void> {
    const ids = [...new Set(lines.map((line) => line.equipmentId))];
    if ((await tx.equipment.count({ where: { id: { in: ids } } })) !== ids.length) {
        throw new UnknownReference('One or more equipment IDs are invalid.');
    }
    await tx.recipeEquipment.createMany({
        data: lines.map((line, orderIndex) => ({ recipeId, orderIndex, ...line })),
    });
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
 * List recipes one page at a time, optionally filtered by a fuzzy search
 * term, a tag, or both.
 *
 * Query params (see `recipeListQuerySchema`):
 *  - `search` (string, optional): fuzzy-match against recipe names.
 *  - `tag` (UUID, optional, 3b): only recipes with this tag. An unknown tag
 *    has no recipes, so the list is empty.
 *  - `limit` (0–100, default 50) and `offset` (default 0): which page.
 *
 * Plain lists are ordered by name, then id. Search results are ordered by
 * rank, then name, then id. The `X-Total-Count` header gives the number of
 * recipes (or matches) across all pages (D6).
 *
 * Each recipe is a summary (`RECIPE_SUMMARY_SELECT`), with its tags: the
 * recipe page fetches the lines and method with `GET /api/recipes/:id`.
 *
 * @returns 200 with an array of recipe summaries (may be empty), or 400 for a bad query.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = parseOr400(recipeListQuerySchema, req.query, res);
        if (query === null) return;
        const { search, tag, limit, offset } = query;

        if (search) {
            const { matches, total } = await fuzzySearchByName(
                'Recipe',
                search,
                { limit, offset },
                tag === undefined ? undefined : recipesTagged(tag),
            );

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

        const where = tag === undefined ? {} : { tags: { some: { tagId: tag } } };
        const [recipes, total] = await Promise.all([
            prisma.recipe.findMany({
                where,
                select: RECIPE_SUMMARY_SELECT,
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                take: limit,
                skip: offset,
            }),
            prisma.recipe.count({ where }),
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
 *  - `description`, `servings`, `prepTime`, `cookTime` (optional)
 *  - `sections` (array of `{ name, steps: [{ text, timerSeconds }] }`, optional, 3b)
 *  - `ingredients` (array of `{ ingredientId, quantity, quantityMax, unit, note, sectionIndex }`, optional)
 *  - `tagIds` (array of tag ids, in order, optional, 3b)
 *  - `equipment` (array of `{ equipmentId, quantity, optional }`, optional, 3b)
 *
 * @returns 201 with the created Recipe and its `ETag`, 400 on validation
 *          failure or an unknown ingredient, tag or item, or 409 if a recipe
 *          already has the given `id`.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = parseOr400(createRecipeSchema, req.body, res);
        if (body === null) return;

        // Spreading is safe here: the strict schema has already rejected
        // any field that isn't on its allowlist.
        const { ingredients = [], sections = [], tagIds = [], equipment = [], ...fields } = body;

        // One transaction: a taken id or a bad ingredient, tag or item id leaves nothing behind
        const recipe = await prisma.$transaction(async (tx) => {
            const created = await tx.recipe.create({ data: fields });
            const sectionIds = await writeSections(tx, created.id, sections);
            await writeLines(tx, created.id, ingredients, sectionIds);
            await writeTags(tx, created.id, tagIds);
            await writeEquipment(tx, created.id, equipment);
            return tx.recipe.findUniqueOrThrow({ where: { id: created.id }, include: RECIPE_INCLUDE });
        });

        res.status(201).set('ETag', recipeEtag(recipe.updatedAt)).json(recipe);
    } catch (error) {
        if (isPrismaError(error, 'P2002')) {
            // A recipe's only unique fields are its id and its main image, which
            // can't be set here, so this is a taken id. The transaction changed nothing.
            res.status(409).json({ error: 'A recipe with that id already exists.' });
        } else if (error instanceof UnknownReference) {
            res.status(400).json({ error: error.message });
        } else if (isPrismaError(error, 'P2003')) {
            res.status(400).json(BAD_INGREDIENTS);
        } else {
            next(error);
        }
    }
});

// ── PATCH /api/recipes/:id ──────────────────────────────────────────────────
/**
 * Partially update a recipe. Only supplied fields are changed.
 *
 * `ingredients`, and from 3b `sections`, `tagIds` and `equipment`:
 *  - absent: left untouched.
 *  - an array: **replaced** entirely (delete all, then re-create), in one
 *    transaction with the rest of the change.
 *  - an empty array: all removed.
 * `sections` comes only with `ingredients` (the schema checks), since new
 * sections get new ids and the lines are re-created to point at them.
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
        const { ingredients, sections, tagIds, equipment, ...fields } = body;
        const id = req.params.id;

        const recipe = await prisma.$transaction(async (tx) => {
            // First, and in one statement: the version check and the recipe's own
            // fields. It locks the row, so a write racing this one waits, then
            // finds the version has moved on (F3)
            await tx.recipe.update({ where: recipeWhere(id, expected), data: { ...fields, updatedAt: new Date() } });
            let sectionIds: string[] = [];
            if (sections) {
                // Deleting them also takes their steps, and unsets the lines' sectionId
                await tx.recipeSection.deleteMany({ where: { recipeId: id } });
                sectionIds = await writeSections(tx, id, sections);
            }
            if (ingredients) {
                await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
                await writeLines(tx, id, ingredients, sectionIds);
            }
            if (tagIds) {
                await tx.recipeTag.deleteMany({ where: { recipeId: id } });
                await writeTags(tx, id, tagIds);
            }
            if (equipment) {
                await tx.recipeEquipment.deleteMany({ where: { recipeId: id } });
                await writeEquipment(tx, id, equipment);
            }
            return tx.recipe.findUniqueOrThrow({ where: { id }, include: RECIPE_INCLUDE });
        });

        res.status(200).set('ETag', recipeEtag(recipe.updatedAt)).json(recipe);
    } catch (error) {
        if (isPrismaError(error, 'P2025')) {
            await sendMissOrStale(res, req.params.id, expected);
        } else if (error instanceof UnknownReference) {
            res.status(400).json({ error: error.message });
        } else if (isPrismaError(error, 'P2003')) {
            res.status(400).json(BAD_INGREDIENTS);
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
